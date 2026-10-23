function createQueryLimiter(maxConcurrent) {
  let active = 0;
  const waiting = [];
  return task => new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    if (active < maxConcurrent) run();
    else waiting.push(run);
  });
}

module.exports = { queryWithLimit: createQueryLimiter(3) };
