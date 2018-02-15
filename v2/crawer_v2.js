const cheerio = require('cheerio'),
  async = require('async'),
  request = require('request'),
  _ = require('lodash'),
  isChinese = require('is-chinese'),
  winston = require('winston'),
  format = require('date-fns/format'),
  parseString = require('xml2js').parseString,
  getPollResult = require('../lib/pollDataHelper'),
  logger = new(winston.Logger)({
    transports: [
      new(winston.transports.Console)(),
      new(winston.transports.File)({
        filename: `${process.cwd()}/log/${format(new Date, 'YYYY-MM-DDTHH')}`,
        level: 'error'
      })
    ]
  });

const CONFIG = {
  bggLink: 'https://boardgamegeek.com/browse/boardgame/page/',
  filterParams: 'sort=rank',
  api: 'https://www.boardgamegeek.com/xmlapi2/thing',
  bggGameUrl: 'https://boardgamegeek.com/boardgame'
} 

class bggCrawler {
  constructor(gameId) {
    this.url = CONFIG.bggLink;
    this.api = CONFIG.api;
    this.filterParams = CONFIG.filterParams;
    this.gameId = gameId;
  }


  _formatBgData(gm) {
    //set default chinese name
    gm.chineseName = "Not provided";
    gm['poll'] = getPollResult(gm['poll']);
    ['name', 'yearpublished', 'minplayers', 'maxplayers', 'playingtime', 'minplaytime', 'maxplaytime', 'minage', 'link'].forEach((key) => {
      if (_.isEmpty(gm[key])) {
        return
      }
      let tem = [];
      let chineseName = 'Not provided';
      gm[key].forEach((i) => {
        if (key === 'name' && !!i['$'].value && isChinese(i['$'].value)) {
          chineseName = i['$'].value;
          gm.chineseName = chineseName;
        }
        if (key === 'link') {
          let linkObj = {
            type: i['$'].type,
            id: i['$'].id,
            value: i['$'].value
          }
          tem.push(linkObj);
          return;
        }
        if (_.includes(['yearpublished', 'minplayers', 'maxplayers', 'playingtime', 'minplaytime', 'maxplaytime', 'minage'], key)) {
          tem.push(+i['$'].value);
          return;
        }
        tem.push(i['$'].value);
      })
      gm[key] = tem;
    })
    return gm;
  }

  _getGameDetailsObj(gameDetails) {
    let res = [];
    let _this = this;
    let gm = gameDetails[0].items.item[0];
    let {
      name,
      image,
      yearpublished,
      minplayers,
      maxplayers,
      playingtime,
      minplaytime,
      maxplaytime,
      minage,
      link,
      poll,
      description
    } = gm;
    let game = {
      name,
      image,
      yearpublished,
      minplayers,
      maxplayers,
      playingtime,
      minplaytime,
      maxplaytime,
      minage,
      link,
      poll,
      description
    }
    game = _this._formatBgData(game);
    game.defaultName = game.chineseName || game.name[0];
    res.push(game);

    return res;
  }

  getDetailedGameInfoFromApi(idList, callback) {
    let options = {
      uri: `${CONFIG.api}?id=${idList}`,
      method: 'GET',
      timeout: 900000
    }
    request(options, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        parseString(body, (err, res) => {
          if (err) {
            return callback(err);
          }
          return callback(null, res);
        })
      } else {
        console.log('err: ' + error)
        let emptyGameInfo = idList.split(',').map((i) => {
          return {gameId: +i.trim()}
        })
        return callback(null, emptyGameInfo);
      }
    })
  }

  getGameDetailsWraper(callback) {
    let _this = this;
    let idLists = [_this.gameId]
    async.mapLimit(idLists, 1, _this.getDetailedGameInfoFromApi, (error, gameDetails) => {
      if (error) {
        return callback(error);
      }
      return callback(null, _this._getGameDetailsObj(gameDetails));
    })
  }
}

module.exports = bggCrawler;
