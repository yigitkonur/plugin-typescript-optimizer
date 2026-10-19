export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadWidget } = await import("@/lib/widgets/loader");
    await loadWidget("metrics");
  }
}
