

module.exports = class Peer {
  constructor(socketId, userId) {
    this.id = socketId;
    this.userId = userId;
    this.transports = new Map();
    this.consumers = new Map();
    this.producers = new Map();
  }

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  };

  async connectTransport(transportId, dtlsParameters) {
    await this.transports.get(transportId).connect({dtlsParameters});
  }

  async createProducer(producerTransportId, rtpParameters, kind) {
    const producer = await this.transports
      .get(producerTransportId)
      .produce({
        kind,
        rtpParameters
      });
    this.producers.set(producer.id, producer);
    producer.on('transportclose', () => {
      producer.close();
      this.producers.delete(producer.id);
    });
    return producer;
  }

  async createConsumer(consumerTransportId, producerId, rtpCapabilities) {
    const consumerTransport = this.transports.get(consumerTransportId);

    const consumer = await consumerTransport.consume({
      producerId: producerId,
      rtpCapabilities,
      paused: false
    });

    if (consumer.type === 'simulcast') {
      await consumer.setPreferredLayers({
        spatialLayer: 2,
        temporalLayer: 2
      });
    }

    this.consumers.set(consumer.id, consumer);

    consumer.on(
      'tansportclose',
      () => this.consumers.delete(consumer.id)
    );

    return {
      consumer,
      params: {
        producerId: producerId,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused
      }
    };
  }

  closeProducer(producerId) {
    try {
      this.producers.get(producerId).close();
    } catch (err) {
      console.warn(err);
    }

    this.producers.delete(producerId);
  }

  removeConsumer(consumerId) {
    this.consumers.delete(consumerId);
  }
}
