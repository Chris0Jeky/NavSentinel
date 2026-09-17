# NavSentinel Vision Lab: unpacked extension

This is independently written, experimental MV3 source, not the upstream NavSentinel build. Load this directory through Chrome's Extensions page with Developer mode enabled. Installation starts passive. Enable an exact HTTP(S) origin through the extension toolbar popup, then reload that page. Other sites need an explicit host-permission grant. Use a dedicated testing profile.

The complete Vision Lab bundle provides `daemon/server.cjs` and inert fixtures at `http://127.0.0.1:4319`. Test captured clicks/submits, bounded transparent-layer cleanup, popup Undo and one-use reviewed navigation. The extension does not read password values, install OS hooks, universally intercept network/navigation APIs, or claim complete protection. `form.submit()` deliberately remains a known survivor.

Runtime validation was blocked by the managed browser policy in the build environment. Syntax/source checks are not an extension efficacy pass. Run the complete bundle's `tests/live_extension.py` and manual browser gate on your local test machine before relying on any behavior. No browser policy should be disabled to make a test pass.

This independent prototype's source is provided under the root bundle's MIT license. Upstream NavSentinel and external dependencies retain their own ownership and licenses.
