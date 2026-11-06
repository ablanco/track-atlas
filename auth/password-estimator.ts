import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { maximumPasswordBytes } from "./password-strength";
import * as common from "@zxcvbn-ts/language-common";
import * as en from "@zxcvbn-ts/language-en";
import * as es from "@zxcvbn-ts/language-es-es";
import * as fr from "@zxcvbn-ts/language-fr";
import * as pt from "@zxcvbn-ts/language-pt-br";
import * as de from "@zxcvbn-ts/language-de";
import * as it from "@zxcvbn-ts/language-it";

// One immutable configuration prevents locale changes or concurrent requests
// from changing the acceptance policy. Feedback is translated by the app.
export const passwordEstimator = new ZxcvbnFactory({
  dictionary: {
    ...common.dictionary,
    ...en.dictionary,
    ...es.dictionary,
    ...fr.dictionary,
    ...pt.dictionary,
    ...de.dictionary,
    ...it.dictionary,
  },
  graphs: common.adjacencyGraphs,
  maxLength: maximumPasswordBytes,
});
