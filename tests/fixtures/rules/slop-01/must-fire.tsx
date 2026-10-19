export function View() {
  try {
    render();
  } catch (e) {
    throw e;
  }
  return <div />;
}
