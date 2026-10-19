import { fetchItem } from "./api.js";
import { formatItem } from "./format.js";

fetchItem("http://localhost:8000", 1).then((item) => {
  console.log(formatItem(item));
});
