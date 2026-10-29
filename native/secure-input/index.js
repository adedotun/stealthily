'use strict';
// Loads the compiled N-API binding if present. When the binding is
// missing (e.g. a dev checkout where the addon was never built), the
// module degrades to a no-op so the app never breaks over this feature.
let binding = null;
try {
  binding = require('./build/Release/secure_input.node');
} catch (_) {
  binding = null;
}

module.exports = {
  available: !!binding,
  // Returns the OSStatus from EnableSecureEventInput (0 = success),
  // or -1 when the binding is unavailable.
  enable() { return binding ? binding.enable() : -1; },
  disable() { return binding ? binding.disable() : -1; },
  isEnabled() { return binding ? !!binding.isEnabled() : false; },
};
