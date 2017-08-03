const cheerio = require('cheerio'),
  async = require('async'),
  request = require('request'),
  _ = require('lodash'),
  isChinese = require('is-chinese'),
  winston = require('winston'),
  format = require('date-fns/format'),
  parseString = require('xml2js').parseString,
  getPollResult = require('./pollDataHelper'),
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
  constructor(pageLimit = 1) {
    this.url = CONFIG.bggLink;
    this.api = CONFIG.api;
    this.filterParams = CONFIG.filterParams;
    this.pageLimit = pageLimit;
  }

  _getGameNameByRank($, page) {
    let selector = '#CEcell_objectname';
    let rank = (page - 1) * 100 + 1;
    let itemNum = 1;
    let name = 'init';
    let res = []; 
    while(!_.isEmpty(name)) {
      name = $(`${selector}${itemNum++} a`).text();
      if (name) {
        res.push({rank: rank++, name});
      }
    }
    return res;
  }

  _getGameThumbnail($) {
    let res = [];
    $('.collection_thumbnail img').each(function(i, elem) {
      let href = elem.parent.attribs.href;
      res.push({thumbnail: elem.attribs.src, bgglink: href, gameId: +href.split('/')[2]})
    });
    return res;
  }

  _getGameRating($) {
    let res = [];
    $('.collection_bggrating').each(function(i, elem) {
      if (i % 3 === 1) {
        let rating = +elem.children[0].data.replace(/(?:\t\n|\t|\n)/g, '');
        if (rating != 0) {
          res.push({rating});
        }
      }
    });
    return res;
  }

  _getIdList(data) {
    return data.reduce((acc, val) => !!acc ? `${acc},${val.gameId}` : val.gameId, '');
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

  _getGameDetailsObj(gameLists, gameDetails) {
    let res = [];
    let _this = this;
    for (let i = 0; i < gameLists.length; i++) {
      if (gameLists[i].result.length !== gameDetails[i].items.item.length) {
        console.log('game length not matching')
      }
      for (let j = 0; j < gameLists[i].result.length; j++) {
        let gm = gameDetails[i].items.item[j];
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
        let defaultName = gameLists[i].result[j].name;
        let game = _.extend({}, gameLists[i].result[j], {
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
        })
        game = _this._formatBgData(game);
        game.defaultName = defaultName;
        res.push(game);
      }
    }
    return res;
  }

  getBgInfoBasedOnPage(callback) {
    let _this = this;
    let tasks = [];
    for (let i = 1; i <= this.pageLimit; i++) {
      tasks.push({
        page: i,
        result: '',
        url: `${this.url}${i}?${this.filterParams}`
      });
    }

    function iteratee(o, cb) {
      let options = {
        uri: o.url,
        method: 'GET',
        timeout: 240000
      }
      request(o.url, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          let $ = cheerio.load(body);
          let gameNames = _this._getGameNameByRank($, +o.page);
          let gameThumbnails = _this._getGameThumbnail($);
          let ratings = _this._getGameRating($)
          let gameObj = [];
          if (gameNames.length === gameThumbnails.length && gameThumbnails.length === ratings.length) {
            for (let i = 0; i < gameNames.length; i++) {
              let {rank, name} = gameNames[i];
              let {thumbnail, bgglink, gameId} = gameThumbnails[i];
              let {rating} = ratings[i];
              gameObj.push({rank, name, gameId, thumbnail, bgglink, rating});
            }
            o.result = gameObj;
            return cb(null, gameObj);
          } else {
            return cb(new Error("can't get game info form bgg.com"));
          }
        }
        return cb(new Error("Http request error"));
      })
    }

    async.eachLimit(tasks, 2, iteratee, (err) => {
      if (err) {
        return callback(err);
      }
      return callback(null, tasks);
    })

  }

  getDetailedGameInfoFromApi(idList, callback) {
    setTimeout(function() {
      let options = {
        uri: `${CONFIG.api}?id=${idList}`,
        method: 'GET',
        timeout: 900000
      }
      request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log("Processing bgg api calls based on id lists")
          parseString(body, (err, res) => {
            if (err) {
              return callback(err);
            }
            return callback(null, res);
          })
        } else {
          console.log('err: ' + error)
          console.log(response)
          return callback(new Error("Http request error"));
        }
      })
    }, 30000);
  }

  getGameDetailsWraper(callback) {
    let _this = this;
    this.getBgInfoBasedOnPage((err, gameListsByPage) => {
      if (err) {
        return callback(err);
      }
      
      let idLists = [];
      gameListsByPage.forEach((o, index) => {
        console.log(`Processing page ${index}`);
        idLists.push(_this._getIdList(o.result));
        if (index === 3) {
          console.log(idLists[idLists.length-1])
        }
      })

      async.mapLimit(idLists, 10, _this.getDetailedGameInfoFromApi, (error, gameDetails) => {
        if (error) {
          return callback(error);
        }
        return callback(null, _this._getGameDetailsObj(gameListsByPage, gameDetails));
      })

    })
  }

  getGameWeight(gameId, callback) {
    let bggUrl = CONFIG.bggGameUrl;
    let options = {
      uri: `${bggUrl}/${gameId}`,
      method: 'GET',
      timeout: 240000
    }
    request(options, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log(`sent request to get game weight`);
        let $ = cheerio.load(body);
        let html = $.html();
        let index = html.indexOf("averageweight");
        let l = index;
        let r = index;
        while (l >= 0) {
          if (html.charAt(l) === '{') {
            break;
          }
          l--;
        }
        while (r < html.length) {
          if (html.charAt(r) === '}') {
            break;
          }
          r++;
        }
        let res = JSON.parse(html.substring(l, r+1));
        return callback(null , res)
      }
      return callback(new Error("Http request error"));
    })
  }

}

module.exports = bggCrawler;
