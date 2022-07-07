

const {networkInterfaces} = require('os');
const ifaces = networkInterfaces();

module.exports = class Room {
  constructor(roomId, worker, io, webRtcServer) {
    this.id = roomId;
    this.worker = worker;
    this.io = io;
    this.webRtcServer = webRtcServer;
    this.peers = new Map();
  }

  async init() {
    this.router = await this.worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        }
      ]
    });
  }

  addPeer(peer) {
    this.peers.set(peer.id, peer)
  }

  getProducerListForPeer() {
    const producersList = [];
    this.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        producersList.push({
          producerId: producer.id
        });
      });
    });
    return producersList;
  }

  async createWebRtcTransport(socketId) {
    const transport = await this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      // listenIps: getListenIps(),
      // listenIps: 
      // [
      //   {ip: '0.0.0.0', announcedIp: '0.0.0.0'}
      // ],
      // TODO: try webRtcServer https://github.com/versatica/mediasoup-demo/blob/v3/server/config.example.js#L143
      // getListenIps(),
      // [
      //   {ip: '172.31.6.97', announcedIp: '54.193.157.102'}
      // ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000
    });
    
    transport.on(
      'dtlsstatechange',
      dtlsState => {
        if (dtlsState === 'closed') transport.close();
      }
    );

    this.peers.get(socketId).addTransport(transport);

    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    };
  }

  async connectPeerTransport(socketId, transportId, dtlsParameters) {
    await this.peers
      .get(socketId)
      .connectTransport(transportId, dtlsParameters);
  }

  async produce(socketId, producerTransportId, rtpParameters, kind) {
    const producer = await this.peers
      .get(socketId)
      .createProducer(producerTransportId, rtpParameters, kind);
    
    this.broadcast(socketId, 'newProducers', [{
      producerId: producer.id,
      producerSocketId: socketId
    }]);

    return producer.id;
  }

  async consume(socketId, consumerTransportId, producerId, rtpCapabilities) {
    const {consumer, params} = await this.peers
      .get(socketId)
      .createConsumer(consumerTransportId, producerId, rtpCapabilities);
    
    consumer.on(
      'producerclose',
      () => {
        this.peers.get(socketId).removeConsumer(consumer.id);
        this.io.to(socketId).emit('consumerClosed', {
          consumerId: consumer.id
        });
      }
    );

    return params;
  }

  closeProducer(socketId, producerId) {
    this.peers.get(socketId).closeProducer(producerId);
  }

  broadcast(socketId, userId, data) {
    const peerIds = Array
      .from(this.peers.keys())
      .filter(id => id !== socketId);
    
    for (const peerId of peerIds) {
      this.send(peerId, userId, data);
    }
  }

  send(socketId, userId, data) {
    this.io.to(socketId).emit(userId, data);
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

};
