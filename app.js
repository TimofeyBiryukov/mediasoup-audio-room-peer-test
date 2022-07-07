

const express = require('express');
const socketIo = require('socket.io');
const {createServer} = require('http');
const bodyParser = require('body-parser');
const mediasoup = require('mediasoup');

const Room = require('./src/Room.js');
const Peer = require('./src/Peer.js');

const app = express();
const server = createServer(app);
const io = socketIo(server);
// const os = require('os');

app.use(express.static('public'));
app.use(bodyParser());

const workers = [];
const roomsList = new Map();

let nextMediasoupWorkerIdx = 0;

let webRtcServer = null;

(async () => {
  // for (let i = 0; i < Object.keys(os.cpus()).length; i++) {
  const worker = await mediasoup.createWorker();

  worker.on('died', () => {
    console.error(
      'mediasoup worker died, exiting in 2 seconds... [pid:%d]',
      worker.pid
    );
    setTimeout(() => process.exit(1), 2000);
  });

  workers.push(worker);

  webRtcServer = await worker.createWebRtcServer({
    listenInfos: ['tcp', 'udp'].map(protocol => ({
      protocol,
      ip: process.env.WEB_RTC_SERVER_IP || '0.0.0.0',
      announcedIp: process.env.WEB_RTC_SERVER_ANNOUNCED_IP || '127.0.0.1',
      port: isNaN(parseInt(process.env.WEB_RTC_SERVER_PORT))
        ? 10011
        : parseInt(process.env.WEB_RTC_SERVER_PORT)
    }))
  });
  // }
})();

app.get('/rooms', async (req, res) => {
  res.json(Array.from(roomsList).map(room => room[0]));
});

app.post('/room', async (req, res, next) => {  
  const roomId = req.body.roomId;
  console.log(`POST /room ${roomId}`);
  if (roomsList.has(roomId)) return res.send({
    roomId
  });
  try {
    const room = new Room(
      roomId,
      getMediasoupWorker(),
      io,
      webRtcServer
    );
    await room.init();
    roomsList.set(roomId, room);
    console.log(`POST /room ${roomId} [success]`);
    return res.send({
      roomId
    });
  } catch(err) {
    console.log(`POST /room ${roomId} [error]`);
    return next(err);
  }
});

io.on('connection', socket => {
  socket.on('join', ({roomId, userId}) => {
    console.log('User joined', {userId});
    roomsList.get(roomId).addPeer(new Peer(socket.id, userId));
    socket.roomId = roomId;
  });

  socket.on('getRouterRtpCapabilities', (_, callback) => {
    callback(roomsList.get(socket.roomId).getRtpCapabilities());
  });

  socket.on('getProducers', () => {
    socket.emit(
      'newProducers',
      roomsList.get(socket.roomId).getProducerListForPeer()
    );
  });

  socket.on('createWebRtcTransport', async (_, callback = function() {}) => {
    const { params } = await roomsList
      .get(socket.roomId)
      .createWebRtcTransport(socket.id);
    return callback(params);
  });

  socket.on('connectTransport', async (
    {transportId, dtlsParameters},
    callback
  ) => {
    await roomsList
      .get(socket.roomId)
      .connectPeerTransport(socket.id, transportId, dtlsParameters);
    return callback({});
  });

  socket.on('produce', async (
    {kind, rtpParameters, producerTransportId},
    callback
  ) => {
    const producerId = await roomsList
      .get(socket.roomId)
      .produce(socket.id, producerTransportId, rtpParameters, kind);
    callback({producerId});
  });

  socket.on('consume', async ({
    consumerTransportId,
    producerId,
    rtpCapabilities
  }, callback) => {
    const params = await roomsList
      .get(socket.roomId)
      .consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

    return callback(params);
  });

  socket.on('producerClosed', ({producerId}) => {
    roomsList.get(socket.roomId).closeProducer(socket.id, producerId);
  });
  

});

server.listen(process.env.PORT || 3000);

console.log('Server listening on http://localhost:3000');

function getMediasoupWorker() {
  const worker = workers[nextMediasoupWorkerIdx];
  if (++nextMediasoupWorkerIdx === workers.length) nextMediasoupWorkerIdx = 0;
  return worker;
}
