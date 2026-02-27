import type { UILog } from "./types";
import { isoNow } from "./timing";

export function createUILogger(max = 300) {
  let logs: UILog[] = [];

  function push(level: UILog["level"], msg: string) {
    if (level === "ERROR") console.error(msg);
    else if (level === "WARN") console.warn(msg);
    else console.log(msg);

    logs = [{ atISO: isoNow(), level, msg }, ...logs].slice(0, max);
  }

  function get(): UILog[] {
    return logs;
  }

  function clear() {
    logs = [];
  }

  return { push, get, clear };
}