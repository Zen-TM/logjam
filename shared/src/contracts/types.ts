// Screen contracts: what a surface that exists on BOTH clients is made of, in
// order, with the words it uses. ADR 0020 — share the decision, not the drawing.
//
// A client RENDERS from its contract: a `Record<SectionKeysOn<…>, renderer>`
// iterated in `contractSectionKeys` order, with every word read from `copy`.
// A contract a client is only tested against would be a third copy of the UI.
// `contracts.test.ts` holds the rules a declaration must meet; each client has
// one parity test per contract asserting its renderer map is exactly the set.

export type ContractPlatform = "web" | "gps";

/**
 * One section of a surface. `on` defaults to both clients; a section only one
 * client draws says which, and `reason` says what about the medium rules it
 * out on the other.
 */
export type ContractSection<K extends string = string> = {
  key: K;
  on?: ContractPlatform;
  reason?: string;
};

export type ScreenContract<
  K extends string = string,
  C extends string = string,
> = {
  /** "places.filterSheet" */
  id: string;
  /** The question the surface's hero answers. Documentation, never rendered. */
  question?: string;
  /** The surface's title, where it is a constant. */
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

/** A client's sections, in the contract's order. */
export function contractSectionKeys<
  C extends { sections: readonly ContractSection[] },
  P extends ContractPlatform,
>(contract: C, platform: P): SectionKeysOn<C, P>[] {
  return contract.sections
    .filter((section) => section.on == null || section.on === platform)
    .map((section) => section.key) as SectionKeysOn<C, P>[];
}
