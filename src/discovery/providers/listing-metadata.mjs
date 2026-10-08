export function boundedListing(items = [], limit = 50, totalAvailable = items.length) {
  const safeLimit = Math.max(1, Number(limit) || 50),
    jobs = items.slice(0, safeLimit),
    total = Math.max(jobs.length, Number(totalAvailable) || 0);
  Object.defineProperties(jobs, {
    listingComplete: { value: jobs.length >= total, enumerable: false },
    totalAvailable: { value: total, enumerable: false },
  });
  return jobs;
}

export function uncertainPagedListing(items = [], limit = 50) {
  const safeLimit = Math.max(1, Number(limit) || 50), jobs = items.slice(0, safeLimit);
  Object.defineProperties(jobs, {
    listingComplete: { value: items.length < safeLimit, enumerable: false },
    totalAvailable: { value: items.length, enumerable: false },
  });
  return jobs;
}
