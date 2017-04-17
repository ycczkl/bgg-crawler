const cheerio = require('cheerio'),
  async = require('async'),
  request = require('request'),
  _ = require('lodash'),
  isChinese = require('is-chinese'),
  winston = require('winston'),
  format = require('date-fns/format'),
  parseString = require('xml2js').parseString,
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
  api: 'https://www.boardgamegeek.com/xmlapi2/thing'
} 

class bggCrawler {
  constructor(pageLimit) {
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
    ['name', 'yearpublished', 'minplayers', 'maxplayers', 'playingtime', 'minage', 'link', 'poll'].forEach((key) => {
      let tem = [];
      gm[key].forEach((i) => {
        if (key === 'name' && !isChinese(i['$'].value)) {
          return;
        }
        if (key === 'poll') {
          let title = i['$'].title;
          let name = i['$'].name;
          let totalvotes = +i['$'].totalvotes;
          let result = [];
          if (!_.isEmpty(i.results)) {
            i.results[0].result.forEach((res) => {
              result.push(res['$']);
            })
          }
          tem.push({
            title,
            name,
            totalvotes,
            result
          });
          return;
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
          minage,
          link,
          poll,
          description
        } = gm;
        let game = _.extend({}, gameLists[i].result[j], {
          name,
          image,
          yearpublished,
          minplayers,
          maxplayers,
          playingtime,
          minage,
          link,
          poll,
          description
        })
        game = _this._formatBgData(game);
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
    request(`${CONFIG.api}?id=${idList}`, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        parseString(body, (err, res) => {
          if (err) {
            return callback(err);
          }
          return callback(null, res);
        })
      } else {
        return callback(new Error("Http request error"));
      }
    })
  }

  getGameDetailsWraper(callback) {
    let _this = this;
    this.getBgInfoBasedOnPage((err, gameLists) => {
      if (err) {
        return callback(err);
      }
      
      let idLists = [];
      gameLists.forEach((o, index) => {
        idLists.push(_this._getIdList(o.result));
      })

      async.mapLimit(idLists, 2, _this.getDetailedGameInfoFromApi, (error, gameDetails) => {
        if (error) {
          return callback(err);
        }
        return callback(null, _this._getGameDetailsObj(gameLists, gameDetails));
      })

    })
  }

}

module.exports = bggCrawler;
