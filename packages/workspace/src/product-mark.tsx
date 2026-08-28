export function ProductMark({ variant = "compact" }: { variant?: "compact" | "hero" }) {
  return (
    <svg
      className={`product-mark product-mark--${variant}`}
      data-product-mark={variant}
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="product-mark__field" x="4" y="4" width="120" height="120" />
      <rect className="product-mark__frame" x="21" y="19" width="76" height="82" />
      <path className="product-mark__tail" d="M46 67C35 63 29 55 32 47C34 42 31 38 25 38" />
      <path className="product-mark__dog" d="M44 61L52 55L75 56L84 51L98 52L106 59L113 61L111 69L101 71L98 78L91 78L88 70L79 72L76 91L68 91L68 74L55 74L53 91L45 91L46 72L40 68Z" />
      <path className="product-mark__ear" d="M84 52L94 55L91 67L84 61Z" />
      <circle className="product-mark__eye" cx="100" cy="59" r="2.2" />
      <circle className="product-mark__signal" cx="23" cy="22" r="7" />
    </svg>
  );
}
