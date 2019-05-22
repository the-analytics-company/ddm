_ddm = typeof _ddm !== "undefined" ? _ddm : {
	'e': [],
	'l': [],
	'trigger': function() {
		_ddm.e.push(arguments)
	},
	'listen': function() {
		_ddm.l.push(arguments);
	}
};