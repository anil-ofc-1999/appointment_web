import { deleteE2eUsers } from './support/db';

/** Clean leftovers from an earlier run before, and our own users after. */
export default async function globalSetup() {
  await deleteE2eUsers();
  return async () => {
    await deleteE2eUsers();
  };
}
