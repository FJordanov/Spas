-- Accounts, hiker profile, emergency contacts, medical ID, access log, role changes
-- Existing id, uid and seq_number columns are not changed.

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 20),
  consent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  relationship text NOT NULL CHECK (char_length(btrim(relationship)) BETWEEN 2 AND 50),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_contacts_user_idx ON public.emergency_contacts (user_id);

CREATE TABLE public.medical_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  date_of_birth date CHECK (date_of_birth >= DATE '1900-01-01'),
  blood_type text CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown')),
  allergies text CHECK (char_length(allergies) <= 1000),
  medications text CHECK (char_length(medications) <= 1000),
  conditions text CHECK (char_length(conditions) <= 1000),
  insurance_provider text CHECK (char_length(insurance_provider) <= 100),
  insurance_number text CHECK (char_length(insurance_number) <= 50),
  note text CHECK (char_length(note) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accessed_at timestamptz NOT NULL DEFAULT now(),
  accessed_by uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE
);

ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
