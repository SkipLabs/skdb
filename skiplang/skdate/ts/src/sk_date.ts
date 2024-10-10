import type { int, ptr, Links, ToWasmManager, Utils } from "std";
import type * as Internal from "std/internal.js";

interface ToWasm {
  SKIP_localetimezone: (year: int, month: int, day: int) => int;
  SKIP_localetimezonename: (
    year: int,
    month: int,
    day: int,
  ) => ptr<Internal.String>;
  SKIP_locale: (code: int, value: int) => ptr<Internal.String>;
  SKIP_JS_currenttimemillis: () => number;
}

class LinksImpl implements Links {
  SKIP_localetimezone!: (year: int, month: int, day: int) => int;
  SKIP_localetimezonename!: (
    year: int,
    month: int,
    day: int,
  ) => ptr<Internal.String>;
  SKIP_locale!: (code: int, value: int) => ptr<Internal.String>;

  complete = (utils: Utils, _exports: object) => {
    this.SKIP_localetimezone = (year: int, month: int, day: int) => {
      const date = new Date(year, month - 1, day);
      return -(date.getTimezoneOffset() * 60);
    };
    this.SKIP_localetimezonename = (year: int, month: int, day: int) => {
      const date = new Date(year, month - 1, day);
      const timeZone = date.toLocaleDateString(undefined, {
        timeZoneName: "short",
      });
      return utils.exportString(timeZone);
    };

    /*
     * Retrieves the local version of variables required for formatting using format specifier.
     * A => Full weekday name.
     * a => Abbreviated weekday name.
     * B => Full month name.
     * b => Abbreviated month name.
     * c => Date/Time format string of the locale.
     * x => Date format string of the locale.
     * X => Time format string of the locale.
     * r => AM/PM Time format string of the locale.
     * p => AM or PM locale string.
     */
    this.SKIP_locale = (code: int, value: int) => {
      const str = String.fromCharCode(code);
      if (str == "B" || str == "b") {
        const date = new Date(Date.UTC(2023, 0 + (value - 1), 1)); // January
        const name = date.toLocaleDateString(undefined, {
          month: str == "b" ? "short" : "long",
        });
        return utils.exportString(name);
      }
      if (str == "A" || str == "a") {
        const date = new Date(Date.UTC(2023, 8, 18 + (value - 1))); // A monday
        const name = date.toLocaleDateString(undefined, {
          weekday: str == "a" ? "short" : "long",
        });
        return utils.exportString(name);
      }
      if (str == "p") {
        let hour = 10;
        if (value == 1) {
          hour = 15;
        }
        const date = new Date(2023, 8, 18, hour);
        const m = date
          .toLocaleDateString(undefined, { hour12: true, hour: "numeric" })
          .split(" ");
        return utils.exportString(m[m.length - 1]!);
      }
      if (str == "c" || str == "X" || str == "x" || str == "r") {
        // Not defined
        return utils.exportString("");
      }
      return utils.exportString("%%" + str);
    };
  };
}

class Manager implements ToWasmManager {
  prepare = (wasm: object) => {
    const toWasm = wasm as ToWasm;
    const links = new LinksImpl();
    toWasm.SKIP_localetimezone = (year: int, month: int, day: int) =>
      links.SKIP_localetimezone(year, month, day);
    toWasm.SKIP_localetimezonename = (year: int, month: int, day: int) =>
      links.SKIP_localetimezonename(year, month, day);
    toWasm.SKIP_locale = (code: int, value: int) =>
      links.SKIP_locale(code, value);
    toWasm.SKIP_JS_currenttimemillis = () => Date.now() / 1000;
    return links;
  };
}

/* @sk init */
/**
 * Init the wasm module
 * @returns The module manager
 */
export function init() {
  return Promise.resolve(new Manager());
}
