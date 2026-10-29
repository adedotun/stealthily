// secure_input.c — minimal N-API wrapper around the macOS Carbon
// Secure Event Input API (HIToolbox). While Secure Event Input is
// enabled for the focused application, CGEvent taps owned by other
// processes receive no keyboard events at all — the same protection
// Terminal's "Secure Keyboard Entry" and password fields use.
#include <node_api.h>
#include <Carbon/Carbon.h>

static napi_value Enable(napi_env env, napi_callback_info info) {
  OSStatus status = EnableSecureEventInput();
  napi_value out;
  napi_create_int32(env, (int32_t)status, &out);
  return out;
}

static napi_value Disable(napi_env env, napi_callback_info info) {
  OSStatus status = DisableSecureEventInput();
  napi_value out;
  napi_create_int32(env, (int32_t)status, &out);
  return out;
}

static napi_value IsEnabled(napi_env env, napi_callback_info info) {
  napi_value out;
  napi_get_boolean(env, IsSecureEventInputEnabled() ? true : false, &out);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {
    { "enable", 0, Enable, 0, 0, 0, napi_default, 0 },
    { "disable", 0, Disable, 0, 0, 0, napi_default, 0 },
    { "isEnabled", 0, IsEnabled, 0, 0, 0, napi_default, 0 },
  };
  napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
