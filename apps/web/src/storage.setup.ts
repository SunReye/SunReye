// Every test file's page shares one origin's storage: what a test leaves there (a browser
// remembered without WebGL2, the 2D view chosen) would steer the files after it.
import { afterEach } from "vitest";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
