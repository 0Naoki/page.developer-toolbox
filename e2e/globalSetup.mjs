import { assertFreshBuild } from '../scripts/build-freshness.mjs';

/** ビルドしない e2e:run でも、ソースより古い成果物を検査しない。 */
export default function globalSetup() {
  assertFreshBuild();
}
