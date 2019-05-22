# Global Click Handling

To use global click-handling, you can use the following eventListener.

```
var _glblClckHndlr = function(event) {
	// ... do something. The element that was clicked is available in event.target
}
if(document.addEventListener) {
    document.addEventListener('click', _glblClckHndlr, true);
} else if(document.attachEvent) {
	document.attachEvent('onclick', _glblClckHndlr);
}
```

In the handler function you could for instance use data-* attributes to read things to DDM or other things such as measure the click in GA etc. Another method to provide information to the global click handler would be to use classnames in the format of ddm_key__value or ddm-key--value.