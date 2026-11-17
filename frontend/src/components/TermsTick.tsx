import { Checkbox } from "../ui";
import { Rich } from "../ui/rich";
import { rich } from "@logjam/shared";

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
        updated ? (
          <Rich
            parts={rich`I agree to the updated <tos>Terms</tos> and acknowledge the <privacy>Privacy Policy</privacy>.`}
            tags={{
              tos: (text) => <DocLink href="/tos.html">{text}</DocLink>,
              privacy: (text) => <DocLink href="/privacy.html">{text}</DocLink>,
            }}
          />
        ) : (
          <Rich
            parts={rich`I agree to the <tos>Terms of Use</tos> and acknowledge the <privacy>Privacy Policy</privacy>.`}
            tags={{
              tos: (text) => <DocLink href="/tos.html">{text}</DocLink>,
              privacy: (text) => <DocLink href="/privacy.html">{text}</DocLink>,
            }}
          />
        )
      }
      checked={checked}
      onChange={onChange}
    />
  );
}

export default TermsTick;
