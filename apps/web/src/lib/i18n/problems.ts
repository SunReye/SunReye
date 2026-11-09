import type { components } from "../api/schema";
import { m } from "../paraglide/messages.js";
import type { Locale } from "../paraglide/runtime.js";

type Code = components["schemas"]["Code"];

type Text = typeof m.problem_internal;

/** Every core code's text; a code the core gains fails the type check until it has one. */
const TEXTS: Readonly<Record<Code, Text>> = {
  "request.route": m.problem_request_route,
  "request.method": m.problem_request_method,
  "request.path": m.problem_request_path,
  "request.query": m.problem_request_query,
  "request.body": m.problem_request_body,
  "auth.setup": m.problem_auth_setup,
  "auth.required": m.problem_auth_required,
  "auth.credentials": m.problem_auth_credentials,
  "auth.backoff": m.problem_auth_backoff,
  "auth.configured": m.problem_auth_configured,
  "auth.password": m.problem_auth_password,
  "auth.forbidden": m.problem_auth_forbidden,
  "viewer.none": m.problem_viewer_none,
  "viewer.name": m.problem_viewer_name,
  "viewer.value": m.problem_viewer_value,
  "token.none": m.problem_token_none,
  "token.value": m.problem_token_value,
  "history.range": m.problem_history_range,
  "history.counter": m.problem_history_counter,
  "forecast.range": m.problem_forecast_range,
  "layout.none": m.problem_layout_none,
  "layout.device": m.problem_layout_device,
  "layout.input": m.problem_layout_input,
  "layout.string": m.problem_layout_string,
  "layout.module-type": m.problem_layout_module_type,
  "layout.value": m.problem_layout_value,
  "topology.none": m.problem_topology_none,
  "topology.tree": m.problem_topology_tree,
  "topology.point": m.problem_topology_point,
  "topology.claim": m.problem_topology_claim,
  "topology.role": m.problem_topology_role,
  "topology.device": m.problem_topology_device,
  "location.none": m.problem_location_none,
  "location.value": m.problem_location_value,
  "connection.none": m.problem_connection_none,
  "connection.value": m.problem_connection_value,
  "connection.in-use": m.problem_connection_in_use,
  "device.none": m.problem_device_none,
  "device.connection": m.problem_device_connection,
  "device.profile": m.problem_device_profile,
  "device.profile-change": m.problem_device_profile_change,
  "device.address": m.problem_device_address,
  "setting.none": m.problem_setting_none,
  "setting.read-only": m.problem_setting_read_only,
  "setting.value": m.problem_setting_value,
  "setting.writes-off": m.problem_setting_writes_off,
  "setting.interval": m.problem_setting_interval,
  "setting.precondition": m.problem_setting_precondition,
  "setting.community": m.problem_setting_community,
  "setting.no-snapshot": m.problem_setting_no_snapshot,
  "secret.missing": m.problem_secret_missing,
  "secret.value": m.problem_secret_value,
  "index.value": m.problem_index_value,
  "clock.unsynced": m.problem_clock_unsynced,
  internal: m.problem_internal,
};

const HTTP = /^http\.(\d{3})$/u;

/**
 * The text of a refusal's code in `locale`, the chosen one by default. A core newer than this
 * build, reached through the relay, may answer with a code it has no text for: that is named.
 */
export function problemText(code: string, locale?: Locale): string {
  const options = locale === undefined ? {} : { locale };
  const status = HTTP.exec(code)?.[1];

  if (status !== undefined) return m.problem_http({ status }, options);

  return isCode(code) ? TEXTS[code]({}, options) : m.problem_unknown({ code }, options);
}

function isCode(code: string): code is Code {
  return Object.hasOwn(TEXTS, code);
}
