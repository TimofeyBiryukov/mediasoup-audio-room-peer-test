

const {networkInterfaces} = require('os');
const ifaces = networkInterfaces();

module.exports = class Room {
  constructor(roomId, worker, io) {
    this.id = roomId;
    this.worker = worker;
    this.io = io;
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
      listenIps: [{
        ip: '0.0.0.0',
        announcedIp: this.getLocalIp()
      }],
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
        this.id.to(socketId).emit('consumerClosed', {
          consumerId: consumer.id
        });
      }
    );

    return params;
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

  getLocalIp() {
    let localIp = '127.0.0.1';
    Object.keys(ifaces).forEach((ifname) => {
      for (const iface of ifaces[ifname]) {
        // Ignore IPv6 and 127.0.0.1
        if (iface.family !== 'IPv4' || iface.internal !== false) {
          continue;
        }
        // Set the local ip to the first IPv4 address found and exit the loop
        localIp = iface.address;
        return;
      }
    })
    return localIp;
  }
};
