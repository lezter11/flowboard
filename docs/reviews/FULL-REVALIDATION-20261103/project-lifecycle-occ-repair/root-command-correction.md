# Excluded root reproduction and harness correction

The root command producing `raw/root-project-lifecycle-occ-red.log` passed only the ACCESS test URL. Its `lifecycleFixture` calls the import database helper, which previously fell back to the canonical local harness on55432 when IMPORT/DATABASE URLs were absent. Therefore that run is **excluded** from disposable55931 acceptance evidence. Its SQL was scoped to a newly generated temporary schema with fixture cleanup; it is not a run on the intended isolated database. The initial criteria.md environmental description was mistaken and must be read with this preserved correction; acceptance itself is unchanged.

The project repair builder independently confirms its actual red/red-2 commands used env-i with explicit FLOWBOARD_IMPORT_TEST_DATABASE_URL on55931/flowboard_import_test. Those separately retained commands establish the defect on the correct disposable instance. Root will verify the corrected attack after repair using that exact explicit URL.

Root adds a no-connection regression test that first demonstrates the unsafe fallback. The shared test helper will require an explicit local test URL and explicit port, refusing55432/55479 and URL query overrides. Explicit5432 remains supported for the isolated CI service. No application runtime, credential or production configuration is changed by this fence.
