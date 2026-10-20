SET local check_function_bodies = off;

CREATE TABLE "public"."alerts" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "type"            text                     NOT NULL,
  "priority"        smallint                 NOT NULL,
  "latitude"        double precision,
  "longitude"       double precision,
  "accuracy_m"      double precision,
  "device_id"       text                     NOT NULL,
  "status"          text                     NOT NULL DEFAULT 'new'::text,
  "is_test"         boolean                  NOT NULL DEFAULT false,
  "uid"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "seq_number"      bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "duplicate_of"    uuid,
  "duplicate_score" smallint,
  CONSTRAINT "alerts_duplicate_score_check" CHECK (((duplicate_score >= 0) AND (duplicate_score <= 100))),
  CONSTRAINT "alerts_pkey" PRIMARY KEY (id),
  CONSTRAINT "alerts_priority_check" CHECK ((priority = ANY (ARRAY[1, 2, 3]))),
  CONSTRAINT "alerts_type_check" CHECK ((type = ANY (ARRAY['sos'::text, 'checkin'::text, 'message'::text])))
);

ALTER TABLE "public"."alerts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."problem_reports" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "message"          text                     NOT NULL,
  "contact_email"    text,
  "app_version"      text,
  "theme"            text,
  "device_id"        text,
  "include_location" boolean                  NOT NULL DEFAULT false,
  "latitude"         double precision,
  "longitude"        double precision,
  "selected_alert"   jsonb,
  "status"           text                     NOT NULL DEFAULT 'new'::text,
  "uid"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "seq_number"       bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  CONSTRAINT "problem_reports_contact_email_check" CHECK (((contact_email IS NULL) OR (char_length(contact_email) <= 254))),
  CONSTRAINT "problem_reports_message_check" CHECK (((char_length(message) >= 5) AND (char_length(message) <= 1000))),
  CONSTRAINT "problem_reports_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."problem_reports"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."rate_limit_exempt_devices" (
  "device_id"  text                     NOT NULL,
  "note"       text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "uid"        uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "seq_number" bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  CONSTRAINT "rate_limit_exempt_devices_pkey" PRIMARY KEY (device_id)
);

ALTER TABLE "public"."rate_limit_exempt_devices"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."rate_limit_exempt_devices" FROM "anon", "authenticated";

CREATE TABLE "public"."user_roles" (
  "user_id"    uuid   NOT NULL,
  "role"       text   NOT NULL,
  "uid"        uuid   NOT NULL DEFAULT gen_random_uuid(),
  "seq_number" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "user_roles_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'developer'::text, 'rescue'::text, 'rescue_admin'::text])))
);

ALTER TABLE "public"."user_roles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_roles" FROM "anon";

CREATE OR REPLACE FUNCTION public.calc_duplicate_score (
  seconds_apart double precision,
  meters_apart  double precision,
  tolerance_m   double precision
)
  RETURNS smallint
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  SELECT round(100 * t.f * d.f)::smallint
  FROM (SELECT CASE WHEN seconds_apart <= 120 THEN 1.0
                    WHEN seconds_apart >= 7200 THEN 0.0
                    ELSE 1.0 - (seconds_apart - 120) / 7080.0 END AS f) t,
       (SELECT CASE WHEN meters_apart IS NULL THEN 0.5
                    WHEN meters_apart <= tolerance_m THEN 1.0
                    WHEN meters_apart >= 2000 THEN 0.0
                    ELSE 1.0 - (meters_apart - tolerance_m) / (2000.0 - tolerance_m) END AS f) d
$function$;

CREATE OR REPLACE FUNCTION public.enforce_rate_limit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  recent integer;
  oldest timestamptz;
BEGIN
  IF NEW.device_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rate_limit_exempt_devices e WHERE e.device_id = NEW.device_id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || coalesce(NEW.device_id, '')));

  EXECUTE format(
    'SELECT count(*), min(created_at) FROM public.%I WHERE device_id IS NOT DISTINCT FROM $1 AND created_at > now() - interval ''1 minute''',
    TG_TABLE_NAME
  ) INTO recent, oldest USING NEW.device_id;

  IF recent >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: at most 5 per minute per device'
      USING HINT = 'rate_limit',
            DETAIL = 'retry_after_seconds=' || greatest(1, ceil(extract(epoch FROM (oldest + interval '1 minute' - now()))))::int::text;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."enforce_rate_limit"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.haversine_m (
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
  RETURNS double precision
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  SELECT 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )))
$function$;

CREATE OR REPLACE FUNCTION public.set_alert_duplicate_score()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  prev record;
  secs double precision;
  meters double precision;
  tol double precision;
BEGIN
  NEW.duplicate_of := NULL;
  NEW.duplicate_score := NULL;

  PERFORM pg_advisory_xact_lock(hashtext('alerts:' || coalesce(NEW.device_id, '')));

  SELECT a.id, a.created_at, a.latitude, a.longitude, a.accuracy_m
  INTO prev
  FROM public.alerts a
  WHERE a.device_id = NEW.device_id
    AND a.is_test = NEW.is_test
    AND a.created_at > NEW.created_at - interval '2 hours'
  ORDER BY a.created_at DESC, a.seq_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  secs := extract(epoch FROM (NEW.created_at - prev.created_at));

  IF NEW.latitude IS NULL OR NEW.longitude IS NULL OR prev.latitude IS NULL OR prev.longitude IS NULL THEN
    meters := NULL;
  ELSE
    meters := public.haversine_m(prev.latitude, prev.longitude, NEW.latitude, NEW.longitude);
  END IF;

  tol := least(greatest(50, coalesce(prev.accuracy_m, 0) + coalesce(NEW.accuracy_m, 0)), 1000);

  NEW.duplicate_of := prev.id;
  NEW.duplicate_score := public.calc_duplicate_score(greatest(secs, 0), meters, tol);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."set_alert_duplicate_score"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."alerts"
  ADD CONSTRAINT "alerts_duplicate_of_fkey" FOREIGN KEY (duplicate_of) REFERENCES public.alerts(id) ON DELETE SET NULL;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX alerts_device_created_idx ON public.alerts USING btree (device_id, created_at DESC);

CREATE UNIQUE INDEX alerts_uid_idx ON public.alerts USING btree (uid);

CREATE INDEX problem_reports_device_created_idx ON public.problem_reports USING btree (device_id, created_at DESC);

CREATE UNIQUE INDEX problem_reports_uid_idx ON public.problem_reports USING btree (uid);

CREATE UNIQUE INDEX user_roles_uid_idx ON public.user_roles USING btree (uid);

CREATE TRIGGER alerts_duplicate_score
  BEFORE INSERT ON public.alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_alert_duplicate_score();

CREATE TRIGGER alerts_rate_limit
  BEFORE INSERT ON public.alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rate_limit();

CREATE TRIGGER problem_reports_rate_limit
  BEFORE INSERT ON public.problem_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rate_limit();

CREATE POLICY "Anon can send valid alerts" ON "public"."alerts"
  FOR INSERT
  TO "anon"
  WITH
    CHECK
    (((type = 'sos'::text) AND (priority = 1) AND (status = 'new'::text) AND ((char_length(device_id) >= 1) AND (char_length(device_id) <= 100)) AND ((latitude IS NULL) =
    (longitude IS NULL)) AND ((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))) AND
    ((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))) AND
    ((accuracy_m IS NULL) OR ((accuracy_m >= (0)::double precision) AND (accuracy_m <= (100000)::double precision)))));

CREATE POLICY "Staff can read alerts" ON "public"."alerts"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.user_roles r
  WHERE
    ((r.user_id = auth.uid()) AND ((r.role = ANY (ARRAY['admin'::text, 'developer'::text])) OR ((r.role = ANY (ARRAY['rescue'::text, 'rescue_admin'::text])) AND (alerts.is_test =
    false)))))));

CREATE POLICY "Anon can send valid problem reports" ON "public"."problem_reports"
  FOR INSERT
  TO "anon"
  WITH
    CHECK
    ((((char_length(btrim(message)) >= 1) AND (char_length(btrim(message)) <= 10000)) AND ((contact_email IS NULL) OR ((char_length(contact_email) <= 254) AND (contact_email ~
    '^[^@[:space:]]+@[^@[:space:]]+$'::text))) AND ((app_version IS NULL) OR (char_length(app_version) <= 50)) AND ((theme IS NULL) OR (char_length(theme) <= 20)) AND
    ((device_id IS NULL) OR (char_length(device_id) <= 100)) AND ((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))
    AND ((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))) AND
    (include_location OR ((latitude IS NULL) AND (longitude IS NULL))) AND ((selected_alert IS NULL) OR (pg_column_size(selected_alert) <= 8000))));

CREATE POLICY "Staff can read problem reports" ON "public"."problem_reports"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.user_roles r
  WHERE ((r.user_id = auth.uid()) AND (r.role = ANY (ARRAY['admin'::text, 'developer'::text]))))));

CREATE POLICY "Users can read their own role" ON "public"."user_roles"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() = user_id));

ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."alerts";

GRANT EXECUTE ON FUNCTION "public"."calc_duplicate_score"(double precision, double precision, double precision) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."calc_duplicate_score"(double precision, double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."calc_duplicate_score"(double precision, double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."calc_duplicate_score"(double precision, double precision, double precision) TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_rate_limit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_rate_limit"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_rate_limit"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."haversine_m"(double precision, double precision, double precision, double precision) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."haversine_m"(double precision, double precision, double precision, double precision) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."haversine_m"(double precision, double precision, double precision, double precision) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."haversine_m"(double precision, double precision, double precision, double precision) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_alert_duplicate_score"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_alert_duplicate_score"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_alert_duplicate_score"() TO "service_role";

REVOKE ALL ON SEQUENCE "public"."alerts_seq_number_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."alerts_seq_number_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."alerts_seq_number_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."alerts_seq_number_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."alerts_seq_number_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."alerts_seq_number_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."alerts_seq_number_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."alerts_seq_number_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."problem_reports_seq_number_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."problem_reports_seq_number_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."problem_reports_seq_number_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."problem_reports_seq_number_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."problem_reports_seq_number_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."problem_reports_seq_number_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."problem_reports_seq_number_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."problem_reports_seq_number_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."rate_limit_exempt_devices_seq_number_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."user_roles_seq_number_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."user_roles_seq_number_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."user_roles_seq_number_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."user_roles_seq_number_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."user_roles_seq_number_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."user_roles_seq_number_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."user_roles_seq_number_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."user_roles_seq_number_seq" TO "service_role";

REVOKE ALL ON TABLE "public"."alerts" FROM "anon";

REVOKE ALL ("accuracy_m") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("accuracy_m") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("device_id") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("device_id") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("is_test") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("is_test") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("latitude") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("latitude") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("longitude") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("longitude") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("priority") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("priority") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("status") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("status") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ("type") ON TABLE "public"."alerts" FROM "anon";

GRANT INSERT ("type") ON TABLE "public"."alerts" TO "anon";

REVOKE ALL ON TABLE "public"."alerts" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."alerts" TO "authenticated";

REVOKE ALL ON TABLE "public"."alerts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."alerts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."alerts" TO "service_role";

REVOKE ALL ON TABLE "public"."problem_reports" FROM "anon";

REVOKE ALL ("app_version") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("app_version") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("contact_email") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("contact_email") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("device_id") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("device_id") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("include_location") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("include_location") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("latitude") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("latitude") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("longitude") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("longitude") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("message") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("message") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("selected_alert") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("selected_alert") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ("theme") ON TABLE "public"."problem_reports" FROM "anon";

GRANT INSERT ("theme") ON TABLE "public"."problem_reports" TO "anon";

REVOKE ALL ON TABLE "public"."problem_reports" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."problem_reports" TO "authenticated";

REVOKE ALL ON TABLE "public"."problem_reports" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."problem_reports" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."problem_reports" TO "service_role";

REVOKE ALL ON TABLE "public"."rate_limit_exempt_devices" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rate_limit_exempt_devices" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rate_limit_exempt_devices" TO "service_role";

REVOKE ALL ON TABLE "public"."user_roles" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."user_roles" TO "authenticated";

REVOKE ALL ON TABLE "public"."user_roles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "service_role";

