export function Avatar({
  initial,
  color,
  size = 32,
  ring = false,
}: {
  initial: string;
  color: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-full text-white font-semibold shrink-0 ${
        ring ? "ring-2 ring-wa-deep ring-offset-2" : ""
      }`}
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        fontSize: size * 0.45,
      }}
    >
      {initial}
    </div>
  );
}
