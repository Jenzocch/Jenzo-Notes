// Fail closed at the native boundary, before retrieving credentials or sending data.
function requireCloudBudgetAuthorization() {
  throw new Error("Cloud AI paused: shared NT$100/month budget coordinator and verified prices are not configured.");
}
module.exports = { requireCloudBudgetAuthorization };
