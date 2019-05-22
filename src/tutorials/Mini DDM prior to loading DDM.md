# Using a mini version of DDM prior to loading DDM.

It is possible to start using the ```trigger()``` function of DDM prior to loading the full API of DDM. To do this, include the following script on your page.

```
<script>
    _ddm="undefined"!=typeof _ddm&&"[object Object]"===Object.prototype.toString.call(_ddm)&&"[object Array]"===Object.prototype.toString.call(_ddm.events)?_ddm:{events:[],trigger:function(n,p){p="[object Object]"===Object.prototype.toString.call(p)?p:{};p.name=n;_ddm.events.push(p)}};
</script>
```

After this script is included, you can use ```_ddm.trigger()``` as usual. The events that you are triggering will be handled once DDM is fully loaded.

**NB** only event listeners that listen to historical events will have their handlers called.

