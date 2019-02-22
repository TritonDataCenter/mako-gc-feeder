# mako-gc-feeder 

mako-gc-feedeer is a program that pages through the keys of all instruction
objects uploaded to a particular shard in Manta by the
[manta-garbage-collector](https://github.com/joyent/manta-garbage-collector).

Here is an example of the type of directory this program would generate for a
Manta deployment with 2 index shards and 3 storage nodes.
```
var/
    tmp/
	1.moray.orbit.example.com/
        2.moray.orbit.example.com/
	    1.stor.orbit.example.com
	    2.stor.orbit.example.com
	    3.stor.orbit.example.com
```
Each leaf file contains a listing of instruction objects intended for the
storage node whose metadata is stored on the shard. For example, the file 
`/var/tmp/1.moray.orbit.example.com/1.stor.orbit.example.com` might contain:
```
2019-02-20-18:41:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-92c0706e-5ba1-4b41-b014-55c4db1b0998-mako-1.stor.orbit.example.com
2019-02-20-18:41:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-3d26a769-e591-4a34-9738-0f63df1c1b06-mako-1.stor.orbit.example.com
2019-02-20-18:41:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-440a3cbe-31f0-4fb6-9ef1-f607034a7f46-mako-1.stor.orbit.example.com
2019-02-20-18:42:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-8b7716e8-eacc-48b2-99d3-ca8741fcc9f0-mako-1.stor.orbit.example.com
2019-02-20-18:42:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-8f03d0a4-6ba6-4b7a-af54-350fc6509d7c-mako-1.stor.orbit.example.com
2019-02-20-18:42:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-31a05c48-9f33-4b21-baf4-bfb4531c3488-mako-1.stor.orbit.example.com
2019-02-20-18:42:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-57041d4a-8388-45c9-8052-f020b2b4158c-mako-1.stor.orbit.example.com
2019-02-20-18:43:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-368dc61f-a768-4457-864c-e62b5fd2c77a-mako-1.stor.orbit.example.com
2019-02-20-18:43:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-eaf00f0a-4dab-4b7a-b1ff-2d0669d4bd4b-mako-1.stor.orbit.example.com
2019-02-20-18:43:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-83641fd1-e64a-48dd-8533-0bbef711ad13-mako-1.stor.orbit.example.com
2019-02-20-18:43:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-c3666cd3-3fdf-4a99-8891-2a3ba019c46c-mako-1.stor.orbit.example.com
2019-02-20-18:44:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-afbbb695-0608-43d6-9987-d48b7b1732af-mako-1.stor.orbit.example.com
2019-02-20-18:44:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-e4a17114-d664-4a46-a32a-b707bde3e4c5-mako-1.stor.orbit.example.com
2019-02-20-18:44:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-7f92e3f2-df2d-446a-a2a8-9a413bd6d8dd-mako-1.stor.orbit.example.com
2019-02-20-18:44:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-fecbb6e6-4ea5-44a2-b51b-cfe2cbaa0593-mako-1.stor.orbit.example.com
2019-02-20-18:45:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-5586a0cb-7abc-4f97-afc1-580eb69f8aad-mako-1.stor.orbit.example.com
2019-02-20-18:45:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-5c60ac27-144c-4dfb-8a01-b08b5241a737-mako-1.stor.orbit.example.com
2019-02-20-18:45:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-2ace63ef-7d46-4e93-83c7-ded84efcd673-mako-1.stor.orbit.example.com
2019-02-20-18:45:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-814cce90-3f47-4915-9676-e7a8401759a4-mako-1.stor.orbit.example.com
2019-02-20-18:46:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-21e66889-7818-47ee-9065-394fb3e83d43-mako-1.stor.orbit.example.com
2019-02-20-18:46:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-5a5d9159-a8d1-4c6f-bbdb-0801d35ddd52-mako-1.stor.orbit.example.com
2019-02-20-18:46:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-23b726f0-6df4-4b1e-9d11-681d1f59c69a-mako-1.stor.orbit.example.com
2019-02-20-18:46:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-c07c1490-737d-4915-8ef7-12ee086ed07d-mako-1.stor.orbit.example.com
2019-02-20-18:47:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-2f2dd00d-b848-4c3a-9777-245ab0b3fedb-mako-1.stor.orbit.example.com
2019-02-20-18:47:06-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-c2631bb4-d8ed-4706-8560-9d24b3e36cdf-mako-1.stor.orbit.example.com
2019-02-20-18:47:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-228b2ebf-a6ec-4265-901a-a66987b96c1c-mako-1.stor.orbit.example.com
2019-02-20-18:47:36-6bbf4a97-e6e6-48f1-97c0-67c59479f5cd-X-f58b465c-994a-4285-aa66-a66fa2444d78-mako-1.stor.orbit.example.com
...
```
The intent is for the output of this program to be processed by a Manta
[mako](https://github.com/joyent/manta-mako)'s cron-driven mako_gc.sh
[script](https://github.com/joyent/manta-mako/blob/master/bin/mako_gc.sh) and
therefore circumvent the limitations of listing large directories in Manta. 

## Installing

```
$ npm install
```

## Running

Generate configs for n processes:
```
node genconfigs.js n
```

Run a process:
```
node main.js [-f CONFIG_FILE | etc/config.json]
```
