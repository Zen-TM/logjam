// Screen contracts: what a surface that exists on BOTH clients is made of, in
// order, with the words it uses. ADR 0020 — share the decision, not the drawing.
//
// A client RENDERS from its contract: a `Record<SectionKeysOn<…>, renderer>`
// iterated in `contractSectionKeys` order, with every word read from `copy`.
// A contract a client is only tested against would be a third copy of the UI.
// `contracts.test.ts` holds the rules a declaration must meet. The `Record` is
// the parity check: `tsc` refuses a missing or an extra key. A map at module
// level also gets a test (`placesContracts.test.ts`); one that closes over
// component state cannot be imported, so the `Record` is its only check.

export type ContractPlatform = "web" | "gps";

/**
 * One section of a surface. `on` defaults to both clients; a section only one
 * client draws says which, and `reason` says what about the medium rules it
 * out on the other (or `gap`, when the other client just lacks it yet).
 */
export type ContractSection<K extends string = string> = {
  key: K;
  on?: ContractPlatform;
  reason?: string;
  /** Not built yet on the other client: a sentence or an issue. A section with
   *  `on` has a `reason` or a `gap`, never both. */
  gap?: string;
  /** Drawn only on something the viewer owns: a page of a shared item has no
   *  such section, on either client. Not a platform difference, so no reason. */
  ownerOnly?: true;
  /** A friend the item is shared with sees this section. The owner's page says
   *  so in the section's title, so the owner knows what they hand over. */
  shareeSees?: true;
};

/**
 * A difference no section or verb carries because it is not a block of the
 * screen: a way in, a gesture, a confirm. One client does it, and `reason`
 * says what about the medium rules it out on the other.
 * `contracts.test.ts` holds every list of these to a non-empty `reason`.
 */
export type ClientOnly = {
  id: string;
  on: ContractPlatform;
  reason: string;
};

export type ScreenContract<
  K extends string = string,
  C extends string = string,
> = {
  /** "places.filterSheet" */
  id: string;
  /** The question the surface's hero answers. Documentation, never rendered. */
  question?: string;
  /**
   * The surface's name, the nav rail's word for it. Logjam Web's hero IS this:
   * its chips already show the counts, so a count in the title says it twice.
   * Logjam GPS's hero says the answer to `question` (its `…HeroTitle`
   * function) and shows this as the eyebrow. A count stays in a title only
   * where nothing else on the panel shows it (Stats' days out).
   */
  title?: string;
  sections: readonly ContractSection<K>[];
  /** Section titles, labels and empty states: the words both clients draw. */
  copy: Readonly<Record<C, string>>;
};

/** The section keys one client draws: the unmarked ones plus its own. */
export type SectionKeysOn<
  C extends { sections: readonly ContractSection[] },
  P extends ContractPlatform,
> = Exclude<C["sections"][number], { on: Exclude<ContractPlatform, P> }>["key"];

/** A client's sections for one viewer: `ownerOnly` ones only when `owned`. */
export function contractSectionsFor<
  C extends { sections: readonly ContractSection[] },
  P extends ContractPlatform,
>(contract: C, platform: P, owned: boolean): SectionKeysOn<C, P>[] {
  return contract.sections
    .filter(
      (section) =>
        (section.on == null || section.on === platform) &&
        (owned || !section.ownerOnly),
    )
    .map((section) => section.key) as SectionKeysOn<C, P>[];
}

/** A client's sections, in the contract's order. */
export function contractSectionKeys<
  C extends { sections: readonly ContractSection[] },
  P extends ContractPlatform,
>(contract: C, platform: P): SectionKeysOn<C, P>[] {
  return contract.sections
    .filter((section) => section.on == null || section.on === platform)
    .map((section) => section.key) as SectionKeysOn<C, P>[];
}

/** The mark on a form field that cannot be left empty: both clients' text
 *  fields draw it beside the label when told the field is `required`. */
export const FORM_REQUIRED = "Required";

/** What a list's data is: still coming, could not be had, or in hand. */
export type LoadState = "loading" | "failed" | "ready";

/**
 * `loaded` is "a successful result is in hand", so a failed first load is
 * `failed` and never `ready` with nothing in it: a list read as empty says
 * "add your first place" over an error. A refetch that fails under a list
 * already shown stays `ready`; its error is a toast.
 */
export function loadStateOf(loaded: boolean, error: string | null): LoadState {
  return loaded ? "ready" : error ? "failed" : "loading";
}
