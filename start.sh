#!/bin/bash

apt-get update
apt-get install build-essential -y

npm i
npm run dev
