import { Checkbox } from "../ui";

function DocLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** The agreement tick, on the sign-up form and in ConsentGate. */
function TermsTick({
  updated = false,
  checked,
  onChange,
}: {
  /** The terms changed since this account agreed to them. */
  updated?: boolean;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Checkbox
      labelHasLinks
      label={
        <>
          I agree to the{" "}
          {updated ? (
            <>
              updated <DocLink href="/tos.html">Terms</DocLink>
            </>
          ) : (
            <DocLink href="/tos.html">Terms of Use</DocLink>
          )}{" "}
          and acknowledge the{" "}
          <DocLink href="/privacy.html">Privacy Policy</DocLink>.
        </>
      }
      checked={checked}
      onChange={onChange}
    />
  );
}

export default TermsTick;
