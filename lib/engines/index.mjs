// Engine registry. Each engine: { name, handles(rule) -> bool, available(detect) -> {ok, reason?}, run(ctx) -> {candidates, notes?} }.
// Rules dispatch by their front matter: regex `tells` -> 'tells'; `adapter: <prefix>:…` -> engine owning that prefix.
import * as tells from './tells-engine.mjs';
import * as astgrep from './astgrep.mjs';
import * as knip from './knip.mjs';
import * as coverage from './coverage.mjs';
import * as project from './project.mjs';
import * as fit from './fit.mjs';
import * as structure from './structure.mjs';
import * as symbols from './symbols.mjs';

export const ENGINES = [tells, astgrep, knip, coverage, project, fit, symbols, structure];
