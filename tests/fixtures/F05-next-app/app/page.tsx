import dynamic from "next/dynamic";

const Chart = dynamic(() => import("@/components/Chart"));

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Chart points={[1, 2, 3]} />
    </main>
  );
}
