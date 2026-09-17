# Continue a saved evidence review

In the Lab Evidence workspace, **Preview export** includes imported observations
and their separate user assessments. Review the hostnames before downloading.
Later, use **Choose evidence file** to open that review package, inspect the
counts and preview, and choose **Import observations** to continue working.

Import appends to existing history. Each incoming observation gets a new local
identifier; its assessments are remapped to that observation, never attached to
an existing row with a matching file identifier. Timestamps and assessment order
are preserved. Repeated imports deliberately append another copy. To replace
the workspace, export anything you need and explicitly clear imported history
first. Scenario history and broker grants stay separate.

Both extension evidence schema 1 and Lab review schema 1 are supported. Reviews
retain the recorded-observation and unverified-user-assessment boundaries. They
cannot change trust, protection settings, or action permissions. Import rejects
unknown fields, malformed records and dangling assessment references before
changing local history. Files are limited to 8 MiB, and accumulated history to
5,000 observations and 5,000 assessments.

This is a local portability contribution to #240/#591, not a new automatic
extension connection, IndexedDB migration, authenticated source, or training
pipeline. Existing extension-only consumers still reject review packages.
