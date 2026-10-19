// Imports
import { user } from './user';

export function load(u: typeof user) {
  // Set the user id
  const userId = u.id;
  // Get the user name
  const name = u.name;
  // Return result
  return { userId, name };
} // end function

// loop through items
for (const i of [1, 2]) {
  console.log(i); // end if
}
