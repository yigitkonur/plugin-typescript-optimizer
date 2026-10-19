export default function Chart({ points }: { points: number[] }) {
  return <pre>{points.join(",")}</pre>;
}
