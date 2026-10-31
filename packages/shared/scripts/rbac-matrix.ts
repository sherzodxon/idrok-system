// Prints docs/architecture/rbac-matrix.md from the code (role-defaults.ts).
import { renderRbacMatrix } from "../src/rbac-matrix";

process.stdout.write(renderRbacMatrix());
