_ = require('lodash')

function getPollResult(poll) {
  let pollResult = [];
  poll.forEach((i) => {
    if (!_.isEmpty(i.results)) {
      let {
        name,
        title,
        totalvotes
      } = i['$'];
      if (name === 'suggested_numplayers') {
        let bestNumberOfPlayers = _findBestNumberOfPlayers(i.results)
        bestNumberOfPlayers = bestNumberOfPlayers.split('+')
        pollResult.push({
          name,
          num: +bestNumberOfPlayers[0],
          hasUpperLimit: bestNumberOfPlayers.length > 1
        })
      } else {
        i.results.forEach((poll) => {
          let value = _findObjectWithMostVotes(poll.result)
          if (!_.isEmpty(_.toNumber(value))) {
            value = _.toNumber(value)
          }
          pollResult.push({
            name,
            value
          })
        })
      }
    }
  })
  return pollResult;
}

function _findObjectWithMostVotes(arr) {
  let res = {}
  arr.forEach((i) => {
    let obj = i['$'];
    if (_.isEmpty(res) || +res['numvotes'] < +obj['numvotes']) {
      res = obj;
    }
  })
  return res.value;
}

function _findBestNumberOfPlayers(allOptions) {
  let bestOptionTitle = '';
  let mostVotes = 0;
  if(!allOptions) {
    return null;
  }
  allOptions.forEach((option) => {
    let optionTitle = option['$']
    option.result.forEach((voteDetails) => {
      voteDetails = voteDetails['$']
      if (voteDetails.value === 'Best' && (_.isEmpty(bestOptionTitle) || mostVotes < +voteDetails['numvotes'])) {
        bestOptionTitle = optionTitle
        mostVotes = +voteDetails['numvotes']
      }
    })
  })
  return bestOptionTitle['numplayers'];
}

module.exports = getPollResult