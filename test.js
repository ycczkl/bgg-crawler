const bggCrawer = require('./v2/crawer_v2');
const {promisify} = require('util');

async function getApiData(gameId) {
  let Crawer =  new bggCrawer(gameId);
  Crawer.crawerPromise = promisify(Crawer.getGameDetailsWraper)
  const bgData = await Crawer.crawerPromise();
  return bgData;
}

async function test() {
  await getApiData(244992)
}

test()
