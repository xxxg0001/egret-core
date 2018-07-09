module RES {
    export let cacheDuration = 30000
    export class Loader {

        public url?:string
        public dispatcher?:egret.EventDispatcher
        public handle?:(data:any)=>void
        public retry:number = 0
        public get(url:string, handle:(data:any)=>void, priority:number=0) {
            
            RES.addRel(url)
            this.url = url
            const data = RES.getRes(url)
            if (data != null) {
                handle(data)
            } else {
                this.retry = 0
                this.dispatcher = RES.getDispatcher(url, priority)
                this.handle = handle  
                this.dispatcher.once(egret.Event.COMPLETE, this.onEvent, this)
                this.dispatcher.once(egret.IOErrorEvent.IO_ERROR, this.onError, this)
            }
        }
        
        private onEvent(e:egret.Event) {
            if (this.dispatcher) {
                this.dispatcher.removeEventListener(egret.IOErrorEvent.IO_ERROR, this.onError, this)
            }
            if (this.handle) {
                const { key, r, subkey } = config.getResourceWithSubkey(<string>this.url, true);
                let p = processor.isSupport(r);
                if (p && p.getData && subkey) {
                    this.handle(p.getData(host, r, key, subkey))
                } else {
                    this.handle(e.data)
                }
                this.handle = undefined
            }
        }
        private onError() {
            if (this.dispatcher) {
                this.dispatcher.removeEventListener(egret.Event.COMPLETE, this.onEvent, this)
            }
            if (this.retry < maxRetry) {
                this.retry++
                this.dispatcher = RES.getDispatcher(<string>this.url, -this.retry)
                this.dispatcher.once(egret.Event.COMPLETE, this.onEvent, this)
                this.dispatcher.once(egret.IOErrorEvent.IO_ERROR, this.onError, this)
            } else {
                this.handle = undefined
            }
        }
        public release() {
            this.handle = undefined
            if (this.dispatcher) {
                this.dispatcher.removeEventListener(egret.Event.COMPLETE, this.onEvent, this)
                this.dispatcher.removeEventListener(egret.IOErrorEvent.IO_ERROR, this.onError, this)
                this.dispatcher = undefined
            } 
            if (this.url) {
                RES.delRel(this.url)
                this.url = undefined
            }            
        }
    }
    export class LoadItem {
        public dispatcher?:egret.EventDispatcher
        public url:string
        public priority:number
        public time:number
        public constructor(url:string, priority:number) {
            this.url = url
            this.priority = priority
            this.time = egret.getTimer()
        }
    }
    function comp(a:LoadItem, b:LoadItem) {
        if (a.priority==b.priority) {
            return a.time - b.time
        } else {
            return a.priority - b.priority
        }
    }
    export let lazyLoadMap:{[key:string]:LoadItem} = {}
    export let lazyLoadList:LoadItem[] = []
    
    export function asyncLoad(url:string, handle:(data:any)=>void, priority:number=0) {
        this.getDispatcher(url, priority).once(egret.Event.COMPLETE, (e:egret.Event)=>{
            const { key, r, subkey } = config.getResourceWithSubkey(<string>url, true);
            let p = processor.isSupport(r);
            if (p && p.getData && subkey) {
                handle(p.getData(host, r, key, subkey))
            } else {
                handle(e.data)
            }
        }, null)
    }
  
    export function changePriority(url:string, priority:number=0) {
        const result = config.getResourceWithSubkey(url, true);
        let info = lazyLoadMap[result.key]
        if (info == null) {
            return
        }
        if (!info.dispatcher) {
            return
        }
        if (lazyLoadList.indexOf(info) >= 0) {
            info.priority = priority
            lazyLoadList.sort(comp)
        }
    }
    export function getDispatcher(url:string, priority:number=0):egret.EventDispatcher {
        const result = config.getResourceWithSubkey(url, true);
        let info = lazyLoadMap[result.key]
        if (info == null) {
            info = new LoadItem(url, priority)
            lazyLoadMap[result.key] = info
        }
        if (!info.dispatcher) {
            info.time = egret.getTimer()
            info.dispatcher = new egret.EventDispatcher()
            if (lazyLoadList.indexOf(info) >= 0) {
                egret.error(`duplicate ${url} ${result.key}`)
            } else {
                lazyLoadList.push(info)
                lazyLoadList.sort(comp)
            }
            
            if (loadingCount < maxThread) {
                egret.callLater(next, null)
            }
        }
        return info.dispatcher
    }
   
    export let loadingCount:number = 0
    export let maxThread:number = 2
    export let maxRetry:number = 3
    
    function next() {
        while(loadingCount < maxThread) {
            
            if (lazyLoadList.length <= 0) {
                break
            }            
            const info = <{dispatcher:egret.EventDispatcher, url:string}>lazyLoadList.pop()
            
            if (info.dispatcher) {
                loadingCount ++
                const { key, r, subkey } = config.getResourceWithSubkey(info.url, true);
                queue.loadResource(r).then(value => {
                    host.save(r, value);
                    loadingCount--
                    const dispathcher = <egret.EventDispatcher>lazyLoadMap[key].dispatcher
                    if (dispathcher) {
                        lazyLoadMap[key].dispatcher = undefined
                        dispathcher.dispatchEventWith(egret.Event.COMPLETE, false, value, false)
                    } else {
                        egret.error(`${key} dispatcher is undefined`)
                    }
                    if (recycles[key]) {
                        recycles[key] = egret.getTimer() + ~~(cacheDuration / 2)
                    }
                    egret.callLater(next, null)
                },()=>{
                    loadingCount--
                    const dispathcher = <egret.EventDispatcher>lazyLoadMap[key].dispatcher
                    if (dispathcher) {
                        lazyLoadMap[key].dispatcher = undefined
                        dispathcher.dispatchEventWith(egret.IOErrorEvent.IO_ERROR)
                    } else {
                        egret.error(`${key} dispatcher is undefined`)
                    }
                    lazyLoadMap[key].dispatcher = undefined
                    host.state[r.name] = HostState.none
                    egret.callLater(next, null)
                })
            }
            
        }
    }

    export let using:{[key:string]:number} = {}
    export let recycles:{[key:string]:number} = {}
    export function addRel(url:string) {
        const { key } = config.getResourceWithSubkey(url, true);
        if (!using[key]) {
            if (recycles[key] != null) {
                delete recycles[key]
            }
            using[key] = 0
        } 
        using[key]++
    }

    export function delRel(url:string, duration:number=cacheDuration) {
        const { key } = config.getResourceWithSubkey(url, true);
        removes(key, 1, duration)
    }
    function removes(key:string, count:number, delay:number) {
        const state = getState(key)
        if (!using[key]) {
            egret.error(`remove resource fail not found ${key}`)
            switch(state) {
                case HostState.loading:
                    recycles[key] = egret.getTimer()
                    break
                case HostState.saved:
                    destroyRes(key)
                    break
            }
            return
        }
        using[key] -= count
        if (using[key] <= 0) {
            using[key] = 0
            switch (state) {
                case HostState.loading:
                case HostState.saved:
                    const t =  recycles[key] || 0
                    recycles[key] = Math.max(t, egret.getTimer() + delay)
                    break
                default:
                    const info = lazyLoadMap[key]
                    if (!info) {//只是做了一个标记，没有启动下载
                        return
                    }
                    if (info.dispatcher) {
                        const i = lazyLoadList.indexOf(info)
                        if (i >= 0) {
                            lazyLoadList.splice(i, 1)
                        }
                        info.dispatcher = undefined
                    }
                    break
            }
        }
    }
    export function startRecycleTimer(interval:number):void {
        setInterval(onRecycleTimer, interval)
    }
    function onRecycleTimer() {
        const now = egret.getTimer()
         for (let key in recycles) {
            if (now >= recycles[key]) {
                dispose(key)
            }
        }
    }
    function dispose(key:string) {
        switch(getState(key)) {
            case HostState.saved:
                destroyRes(key)
                delete recycles[key]
                break
            case HostState.none:
            case HostState.destroying:
                delete recycles[key]
                break
        }
    }
    export function forceRecycle(n:number) {
        const now = egret.getTimer() + n
        for (let key in recycles) {
            if (now >= recycles[key]) {
                dispose(key)
            }
        }
    }
}