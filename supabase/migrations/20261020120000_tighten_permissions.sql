-- Least privilege: remove leftover default permissions

-- 1. Logged-in users can only read these tables (remove the Postgres 17 MAINTAIN permission)
REVOKE MAINTAIN ON public.alerts, public.problem_reports, public.user_roles FROM authenticated;

-- 2. No direct access to the counters behind seq_number
REVOKE ALL ON SEQUENCE
  public.alerts_seq_number_seq,
  public.problem_reports_seq_number_seq,
  public.rate_limit_exempt_devices_seq_number_seq,
  public.user_roles_seq_number_seq
FROM anon, authenticated;

-- 3. Helper functions are not callable through the public API
REVOKE EXECUTE ON FUNCTION public.calc_duplicate_score(double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.haversine_m(double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;

-- 4. New tables and counters are not opened to the API automatically
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
