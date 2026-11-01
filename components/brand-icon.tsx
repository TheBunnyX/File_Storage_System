export function BrandIcon({ size = 32 }: { size?: number }) {
  return <img className="brand-icon" src="/icon.svg" width={size} height={size} alt="" aria-hidden="true" style={{ flexShrink: 0 }} />;
}
