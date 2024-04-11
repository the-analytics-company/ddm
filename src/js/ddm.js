/**
 * The DigitalData Manager (DDM) provides an API for centralized access to the DigitalData object.
 * In addition the DDM provides an event mechanism for data changes in the DD as well as general event handling.
 *
 * The DDM itself is a closure that constructs an initial empty DigitalData object and prepares the DigitalData Manager API.
 */
(function() {
	/**
	 * This is the DigitalData Manager object that exposed the DDM API.
	 *
	 * @type {Object}
	 */
	var _d = {};

	// Internal variables to keep track of previous DD object, property changeHandlers, eventListeners
	// and paths that need to be persisted.
	var _prev_dd = {};
	var _eventListeners = {};
	var _pathsToPersist = {};
	var _propertyListeners = {};
	var _persistenceListeners = {};

	/**
	 * The events array. This keeps track of all events that were triggered using the DDM trigger function.
	 * It is publically available using _ddm.events, which is a direct reference to the events array.
	 *
	 * @type {Array}
	 */
	_d.events = [];

	// Short reference to storage
	var storage;

	try {
		storage = window.localStorage;
	}
	catch(e) {}

	// Prefixes that are used to prefix keynames of keys that are being persisted.
	var storagePrefix = "dd_p_", storageExpirationPrefix = "dd_p_exp_";

	/**
	 * Retrieve data from the DD for a given dot-notated path into the DD. If no value/object is available
	 * at the path, you can optionally create the value/object at that path using a provided value. The
	 * later is merely for convenience.
	 *
	 * @example
	 *
	 * // Get the value of user.id
	 * _ddm.get("user.id");
	 *
	 * // Get the value of cart and if it does not exist, create it as an empty array
	 * _ddm.get("cart", [], true);
	 *
	 * @function
	 * @name get
	 * @param {string} path - The dot notated path to the object/property that you want to retrieve
	 * @param {object} [defaultValue] - An optional defaultValue that you want to use if no object/property is available at the provided path.
	 * @param {boolean} [createNonExisting=false] - Determines if the object/property should be added to DigitalData, using the defaultValue, if it does not exist.
	 * @return {object} Either the value at the path, the defaultValue when provided or undefined if the value does not exist.
	 */
	_d.get = function(path, defaultValue, createNonExisting) {
		var v = getObjectAtPath(path, window._dd);
		// If the retrieved value is undefined and a defaultValue is given, then return the defaultValue and conditionally (createNonExisting) create the value
		// if it did not exist yet. Otherwise simply return the retrieved value, whatever the value may be (can be undefined)
		return _d.cloneObject(typeof v === 'undefined' && typeof defaultValue !== 'undefined' ? (createNonExisting === true ? _d.set(path, defaultValue) : defaultValue) : v);
	};

	/**
	 * Stores an object at a given dot notated path. If an object already exists at the given path, the provided data
	 * will be merged with the existing object. Existing properties with the same name will be overwritten.
	 *
	 * @example
	 * // Store a value in DD
	 * _ddm.set("dot.notated.path", "value");
	 *
	 * // Store a value in DD and make it persisted
	 * _ddm.set("dot.notated.path", "value", true);
	 *
	 * @function
	 * @name set
	 * @param {string} path - The dot notated path of the object/property that you want to store
	 * @param {*} value - The value that you want to store
	 * @param {boolean} [persist=false] - Whether to persist this key or not. Defaults to false.
	 * @param {integer} [ttl=30] - Number of minutes to persist the value. Defaults to 30 minutes.
	 * @return {*} The object being stored.
	 */
	_d.set = function(path, value, persist, ttl) {

		// Try so ddm errors can be caught and handed to a global error handler
		// try {

			// First clone the current DD object to the previous DD object.
			cloneDDtoPreviousDD();

			// If we need to persist, do that first so that a change handler is registered, which will
			// in turn automatically persist the value after it's being set.
			if(persist === true) {
				_d.persist(path, _d.isInteger(ttl) ? ttl : 30);
			}

			// Set the value at the given path
			setObjectAtPath(path, value);

			// Invoke change listeners
			invokeChangeListeners();

			return value;

		// Catch errors and call global error handler
		// }
		// catch(e) {
		// 	handleError(e, "set", arguments);
		// }
	};

	/**
	 * Erases an object from the DD at the provided path. Consequently also unpersists possibly persisted
	 * objects at the provided path and any path underneath the provided path.
	 *
	 * @example
	 * _ddm.erase("dot.notated.path.to.object.that.must.be.erased");
	 *
	 * @function
	 * @name erase
	 * @param  {string} path The path to the object that must be erased
	 */
	_d.erase = function(path) {

		// If it doesn't exists, simply don't do anything.
		if(!_d.has(path)) return;

		// Try so ddm errors can be caught and handed to a global error handler
		try {
			// First clone the current DD object to the previous DD object.
			cloneDDtoPreviousDD();

			// Then split the path and pop the last element so we know which (possibly) nested property we want to delete
			// and then join the remaining elements of the path back together again so we can easily get the object at
			// that path.
			var split = path.split(".");
			var propertyToDelete = split.pop();
			var parentPath = split.join(".");

			// Then delete  the object at provided path
			var parentObject = getObjectAtPath(parentPath, window._dd);

			delete parentObject[propertyToDelete];

			// Now fire possible change listeners
			invokeChangeListeners();

		// Catch errors and call global error handler
		}
		catch(e) {
			handleError(e, "delete", arguments);
		}
	};

	/**
	 * Pushes a value into an array in the DigitalData object. If an array does not exist yet at the given path,
	 * or the object/property at the given path is not an array, an array will be created.
	 *
	 * If the value you provide is an array, a "concat" will be performed with the data
	 *
	 * @example
	 *
	 * // Add a value to an array in the DD
	 * _ddm.push("dot.notated.path.to.array", "value-to-push-into-array");
	 *
	 * @function
	 * @name push
	 * @param {string} path - The dot notated path of the array that you want to push into
	 * @param {*} value - The value that you want to push into the array
	 * @return {array} The array being pushed into
	 */
	_d.push = function(path, value) {

		// Try so ddm errors can be caught and handed to a global error handler
		try {

			// First clone the current DD object to the previous DD object.
			cloneDDtoPreviousDD();

			// Get the array at the provided path. Do not use the convenience "create if not exists" here as that
			// would trigger eventlisteners twice.
			var a = _d.get(path);

			// If it's an array add the value otherwise initialize the array with the provided value.
			if(_d.isArray(a)) {
				setObjectAtPath(path, a.concat(_d.isArray(value)?value:[_d.cloneObject(value)]));
			} else {
				setObjectAtPath(path, [_d.cloneObject(value)]);
			}

			// Invoke change listeners
			invokeChangeListeners();

			// Return the array
			return a;

		// Catch errors and call global error handler
		}
		catch(e) {
			handleError(e, "push", arguments);
		}
	};

	/**
	 * Determines whether the DD has a value at the given path.
	 *
	 * @example
	 * // Test if the DD has a value for user.id
	 * if(_ddm.has("user.id")) {
	 *     // ... DD has user.id
	 * }
	 *
	 * // For an example to use the availabiltiy of a value in DD together with a triggered event,
	 * // see the examples of {@link isTriggered}.
	 *
	 * @function
	 * @name has
	 * @param  {string} path - the dot notated path to the object/property that you want to test.
	 * @return {Boolean} Returns true if the value at the given path is not undefined. False otherwise.
	 */
	_d.has = function(path) {
		return typeof getObjectAtPath(path, window._dd) !== 'undefined';
	};

	/**
	 * Determines whether the object at the given path is null, an empty object/array, an empty string or does not exist at all.
	 * Take note that a string consisting of only whitespace is also regarded as empty and that integer values are never regarded
	 * as being empty.
	 *
	 * @example
	 * // Test if the DD has a user.name that actually has a non-empty value.
	 * if(!_ddm.empty("user.name")) {
	 *     // ... DD has user.name with a non empty value
	 * }
	 *
	 * @function
	 * @name empty
	 * @param {string} path - The dot notated path to the object/property
	 */
	_d.empty = function(path) {
		var obj = (getObjectAtPath(path, window._dd));

		if(obj == null || typeof obj === 'undefined')
			return true;

		if(_d.isObject(obj)) return JSON.stringify(obj) === JSON.stringify({});

		if(_d.isArray(obj)) return obj.length == 0;

		if(_d.isString(obj)) return obj.trim() === '';

		return !_d.isInteger(obj);
	};

	/**
	 * Adds a "change" listener to the DD. Change listeners are being invoked whenever there is
	 * a change in the DD where the path that the listener is interested in is involved. The handler
	 * is also invoked when the listener is registered and there is already data in the DD for the
	 * path it wants to listen to.
	 *
	 * The path is dot notated and can use two types of wildcards. * and **.
	 *
	 * Wildcard listeners using * as the wildcard are invoked whenever there is a change on the
	 * same node-level as the node that was changed. For instance, a listener on user.* would be
	 * invoked whenever user.id or user.firstname would change. It will not be changed for changes
	 * in for instance user.address.zipcode.
	 *
	 * Wildcard listeners using ** as the wildcard are invoked whenever there is a change on the
	 * same node-level as the node that was changed, as well as deeper node levels. For instance,
	 * in the previous situation of user.address.zipcode, listeners for user.** will also be
	 * invoked.
	 *
	 * @example
	 *
	 * // Add a change listener on only the user.products key in the DD
	 * _ddm.change("user.products", function(data) {
	 *     // data holds the value of the user.products object
	 * });
	 *
	 * // Add a change listener on user.products and any of it's direct children.
	 * _ddm.change("user.products.*", function(data) {
	 *     // ... do something
	 * });
	 *
	 *  // Add a change listener on user.products and any of it's children or grandchildren.
	 * _ddm.change("user.products.**", function(data) {
	 *     // ... do something
	 * });
	 *
	 * // Add a change listener on user.id, but do not invoke the handler function if the DD already holds a value for user.id. Only invoke the handler when the property user.id changes.
	 * _ddm.change("user.id", true, function(data) {
	 *     // ... do something
	 * });
	 *
	 * @function
	 * @name change
	 * @param  {string} path - Dot notated path
	 * @param  {boolean} [onlyInvokeOnChanges=false] - Boolean to indicate that the handler should only be invoked when changes occur.
	 * @param  {function} handler - The handler that has to be invoked
	 */
	_d.change = function(path, onlyInvokeOnChanges, handler, id) {

		// Try so ddm errors can be caught and handed to a global error handler
		try {

			// If the handler is a string then onlyInvokeOnChanges was never provided but an id was so copy the handler to the id and onlyInvokeOnChanges to handler.
			if(_d.isString(handler)) {
				id = handler;
				handler = onlyInvokeOnChanges;
			}

			// If the handler parameter is undefined the onlyInvokeOnChanges parameter was probably not passed and holds the handler function
			if(typeof handler === 'undefined') {
				handler = onlyInvokeOnChanges;
			}

			// Register the listener, and if it returns true, it means the handler was not registered
			// for this path before. In that case, check if there is already data at the given path.
			if(registerListener(path, handler, _propertyListeners, id) && (typeof onlyInvokeOnChanges === "function" || onlyInvokeOnChanges !== true)) {

				var v = getObjectAtPath(path.replace(/\.?\*\*?$/, ""), window._dd);

				if(typeof v !== 'undefined') {
					handler(v);
				}
			}

		// Catch errors and call global error handler
		}
		catch(e) {
			handleError(e, "change", arguments);
		}
	};

	/**
	 * This method can be called to trigger an event. It will look up listeners for the provided
	 * name (dot notated, wild cards apply) and invoke all listeners that were interested in the
	 * event. The listeners will recieve an event object, which consists of the provided payload.
	 *
	 * @example
	 *
	 * // Trigger an event without a payload
	 * _ddm.trigger("name-of-event");
	 *
	 * // Trigger an event and provide some event data. Handlers of listeners to this event retrieve the data.
	 * _ddm.trigger("name-of-event", {"key": "value"});
	 *
	 * // Trigger an event and provide data that needs to be put in DD.
	 * _ddm.trigger("name-of-event", {"dd": {"key", "value"}});
	 *
	 * @function
	 * @name trigger
	 * @param  {string} eventName - Name of the event (dot notated, wildcards apply)
	 * @param  {object} payload - The payload of the event. Defaults to an empty object.
	 * @return {Boolean} Returns true if any listeners were invoked, false otherwise.
	 */
	_d.trigger = function(eventName, payload) {

		// Try so ddm errors can be caught and handed to a global error handler
		try {

			// Initialize the event object. This will initially be the payload, otherwise it will be an empty object.
			var event = _d.isObject(payload) ? payload : {};

			// Set the eventName into the event object
			event.name = eventName;

			// Set the current timestamp in the event object
			event.timestamp = new Date().getTime();

			var invokedHandlers = [];

			// If there is a "dd" property in the payload, add the values to the DD.
			if(event.hasOwnProperty('dd') && _d.isObject(event.dd)) {

				// First clone the current DD object to the previous DD object.
				cloneDDtoPreviousDD();

				// Then merge the provided DD values into the actual DD
				_d.mergeObjects(window._dd, _d.cloneObject(event.dd));

				// and then invoke possible change listeners
				invokedHandlers = invokeChangeListeners();
			}

			// Retrieve possible listeners for the event.
			var listeners = getListeners(eventName, _eventListeners);

			// Loop through all listeners and invoke them (but only if the same handler was not invoked by a changelistener)
			for(var l=0; l<listeners.length; l++) {

				for(var h=0; h<listeners[l].handlers.length; h++) {

					var handlerObject = listeners[l].handlers[h];

					// Check if the object has all the required data
					if(_d.isObject(handlerObject) && handlerObject.hasOwnProperty('handler')) {

						// If the handler defines dependsOn and that property is an array, it's a handler that only needs to be called if all other events have been triggered before.
						if(handlerObject.hasOwnProperty('dependsOn')  && _d.isArray(handlerObject.dependsOn)) {

							// Determine the number of events that have triggered within the "dependsOn" array.
							var numTriggered = 0;
							for (var d = handlerObject.dependsOn.length; d-- > 0; ) {
								numTriggered += (handlerObject.dependsOn[d] === eventName || _d.isTriggered(handlerObject.dependsOn[d]) ? 1 : 0);
							}

							// If the number of events that have been triggered matches the number of events this handler depends on, then invoke it.
							if(numTriggered === handlerObject.dependsOn.length && !_arrayHasValue(invokedHandlers, handlerObject.handler)) {
								try {
									if(!handlerObject.hasOwnProperty("once") && handlerObject.handler(event) === true) {
										handlerObject.once = true;
									}
								} catch (e) {
									handleError(e, "listener-handler", event, handlerObject.id);
								}
							}
						}
						// it's a regular event listener that depends on no other events so invoke it if it has not been invoked beofre.
						else if(!_arrayHasValue(invokedHandlers, handlerObject.handler)) {
							try {
								if(!handlerObject.hasOwnProperty("once") && handlerObject.handler(event) === true) {
									handlerObject.once = true;
								}
							} catch (e) {
								handleError(e, "listener-handler", event, handlerObject.id);
							}
						}
					}
				}
			}

			// Push the event into the DD object's events array. This does not have to trigger any
			// changelisteners as the events can already have listeners and the events array is only
			// used for historical lookup purposes.
			_d.events.push(event);

		// Catch errors and call global error handler
		}
		catch(e) {
			handleError(e, "trigger", arguments);
		}
	};

	/**
	 * Global error handler to catch errors that occured during ddm function calls. This will trigger an event so outside script can listen to this.
	 *
	 * @param  {object} error The error object that was provided to the catch block
	 * @param  {String} name  The name of the ddm function the error occured in
	 * @param  {Array} args The arguments array that was provided to the ddm function that was called
	 */
	var handleError = function(error, name, args, id) {
		var a;
		try {
			a = JSON.stringify(args);
		}
		catch(e) {
			a = "error during serialization of arguments: " + e.message;
		}
		var e = {
			'function': name,
			'arguments': a,
			'id': id,
			'message': error.message ? error.message : '',
			'stack': error.stack ? error.stack : ''
		};

		if(typeof window.ddmErrorHandler === 'function') {
			window.ddmErrorHandler(e);
		}
	};

	/**
	 * This function determines if an event with a given name has been triggered before. Returns true if it was, false otherwise.
	 *
	 * @example
	 * // Check if an event with the name "myEvent" has been triggered.
	 * if(_ddm.isTriggered("myName")) {
	 *     // ... do something.
	 * }
	 *
	 * // Using isTriggered() in combination with has(). This way you can define code that depends on the condition that
	 * // the DD has a value for something AND an event has been triggered.
	 *
	 * // Define the handler function as a non-anonymous function.
	 * var handler = function(data) {
	 *     if(_ddm.isTriggered("jquery.loaded") && _ddm.has("session.isp")) {
	 *         // ... do something when the jquery.loaded event was triggered AND the DD has a value/object at session.isp.
	 *     }
	 * };
	 *
	 * // And then use the same handler for both an event-listener and a change-listener. Be sure to also listen for historical events (true as 2nd parameter)
	 * _ddm.listen("jquery.loaded", true, handler);
	 * _ddm.change("session.isp", handler);
	 *
	 * @function
	 * @name isTriggered
	 * @param  {string} name - The name of the event
	 * @return {boolean} True or false depending on whether the event with the given name was triggered before.
	 */
	_d.isTriggered = function(name) {
		// Then reverse loop through the events that have already taken place
		for (var e = _d.events.length; e-- > 0; ) {

			// Check if the current event's name is the name we are looking for and if so, return true.
			if(_d.events[e].name === name) {
				return true;
			}
		}

		return false;
	};

	/**
	 * Adds a event listener. These listeners are being called when the
	 * trigger() method is being called and the name of the listener matches the
	 * name that was provided to the trigger. This can be used as a general event
	 * mechanism. The name is in fact a dot notated path and the same wildcards
	 * as for change listeners apply.
	 *
	 * By default, the handler function will be called for historical events as well.
	 *
	 * It is possible to provide multiple eventnames as an array. All the events
	 * in the array must have been triggered before the handler is being called.
	 *
	 * By returning true in the handler function DDM will mark the handler as an
	 * "execute once" handler and will never call the handler again, unless the
	 * same handler function is used by a different listener registration.
	 *
	 * @example
	 * // Listen to the "dd.loaded" event
	 * _ddm.listen("dd.loaded", function(e) {
	 *     // ... do something
	 * });
	 *
	 * // Listen to the "dd.loaded" event but only invoke the handler function for future events, not historical events.
	 * _ddm.listen("dd.loaded", false, function(e) {
	 *     // ... do something
	 * });
	 *
	 * // Listen to the "dd.loaded" event and return true, which indicates to DDM that it should never call this handler again.
	 * _ddm.listen("dd.loaded", function(e) {
	 *     // ... do something
	 *     return true;
	 * });
	 *
	 * @function
	 * @name listen
	 * @param  {(string|string[])} name - Name of event(s) to listen to (dot notated, wildcards apply)
	 * @param  {boolean} [invokeHandlerOnHistoricalEvents=true] - Boolean that indicates if the handler should also be invoked for historical events.
	 * @param  {function} handler - The handler that has to be invoked
	 * @param  {string} id - The identifier given to this handler. This is used for error handling to aid in debugging.
	 */
	_d.listen = function(name, invokeHandlerOnHistoricalEvents, handler, id) {

		// Try so ddm errors can be caught and handed to a global error handler
		try {

			// If the handler is a string then invoke historical was never provided but an id was so copy the handler to the id and the invoke to handler.
			if(_d.isString(handler)) {
				id = handler;
				handler = invokeHandlerOnHistoricalEvents;
			}
			// else, if the handler parameter is undefined the invokeHandlerOnHistoricalEvents parameter was not passed and holds the handler function
			else if(typeof handler === 'undefined') {
				handler = invokeHandlerOnHistoricalEvents;
			}

			// If the provided name is an array, multiple listeners that depend on each other must be registered
			if(_d.isArray(name)) {
				for (var n = name.length; n-- > 0; ) {
					registerListener(name[n], handler, _eventListeners, name, id);
				}
			}
			// If name is only a single event, then register just a single event listeners
			else {
				registerListener(name, handler, _eventListeners, id);
			}

			// If we need to invoke the handler for historical events
			if(typeof invokeHandlerOnHistoricalEvents !== "boolean" || (typeof invokeHandlerOnHistoricalEvents === "boolean" && invokeHandlerOnHistoricalEvents !== false)) {

				var triggeredEvents = {};

				// Then loop through the events that have already taken place
				for (var e = 0; e < _d.events.length; e++ ) {

					triggeredEvents[_d.events[e].name] = true;

					// get the listeners (array of path+handlers) for the current event in the loop
					var listeners = getListeners(_d.events[e].name, _eventListeners);

					// loop through those (it's an array of objects that have the listening path and an array of actual handlers for that path)
					for (var l = listeners.length; l-- > 0; ) {

						// and then loop through each of the handlers array
						for (var h = listeners[l].handlers.length; h-- > 0; ) {

							var handlerObject = listeners[l].handlers[h];

							// Check if the object has all the required data
							if(_d.isObject(handlerObject) && handlerObject.hasOwnProperty('handler')) {

								if(handlerObject.hasOwnProperty('dependsOn') && _d.isArray(handlerObject.dependsOn)) {

									// Determine the number of events that have triggered within the "dependsOn" array.
									var numTriggered = 0;
									for (var d = handlerObject.dependsOn.length; d-- > 0; ) {
										// Do not use isTriggered because for depending events we must only look at the history up until the current event,
										// otherwise it would trigger multiple times (for each dependency)
										numTriggered += (triggeredEvents.hasOwnProperty(handlerObject.dependsOn[d]) ? 1 : 0);
									}

									// If the number of events that have been triggered matches the number of events this handler depends on then invoke it
									if(numTriggered === handlerObject.dependsOn.length && handler === handlerObject.handler) {
										try {
											if(!handlerObject.hasOwnProperty("once") && handlerObject.handler(_d.events[e]) === true) {
												handlerObject.once = true;
											}
										} catch (ex) {
											handleError(ex, "listener-handler", _d.events[e], handlerObject.id);
										}
									}
								}
								// it's a regular event listener that depends on no other events so check if the handler is the same handler as the one we just
								// registered and if so, invoke it.
								else if(handler === handlerObject.handler) {
									try {
										if(!handlerObject.hasOwnProperty("once") && handlerObject.handler(_d.events[e]) === true) {
											handlerObject.once = true;
										}
									} catch (ex) {
										handleError(ex, "listener-handler", _d.events[e], handlerObject.id);
									}
								}
							}
						}
					}
				}
			}

		// Catch errors and call global error handler
		}
		catch(ex) {
			handleError(ex, "listen", arguments);
		}
	};

	/**
	 * Removes a listener for a given name. This can not be used for listeners that have been registered
	 * using _ddm.listen() with an anonymous function declaration. A reference to the function is required. See examples.
	 *
	 * @example
	 * // Create a non-anonymous handler function (Only non-anonymous functions can be unregistered using _ddm.unlisten)
	 * var myHandler = function(e) {
	 *     // ... do something
	 * }
	 * // Register the handler function as a listener to events with the name "myEvent"
	 * _ddm.listen("myEvent", myHandler);
	 *
	 * // Unregister the handler to stop listening for events with the name "myEvent"
	 * _ddm.unlisten("myEvent", myHandler);
	 *
	 * @function
	 * @name unlisten
	 * @param  {string} name - Name of an event to remove the listener for (dot notated, wildcards apply)
	 * @param  {function} handler - The handler that was to be invoked
	 */
	_d.unlisten = function(name, handler) {
		// Retrieve the array of already registered listeners for the given name (path), or initialize it as an empty array.
		var l = _eventListeners.hasOwnProperty(name) ? _eventListeners[name] : [];

		// Try to find the handler and when found, remove it.
		for (var i = l.length; i-- > 0; ) {
			if(l[i].handler === handler) {
				l.splice(i,1);
			}
		}
	};

	/**
	 * Registers a dot-notated path of the DD as persistent. A TTL can be provided in minutes
	 * how long the value should be persisted. Defaults to 30 minutes.
	 *
	 * This method is also called during the initialization of DDM to register the default
	 * paths that are to be persisted.
	 *
	 * @example
	 * // Register the "user" key to be persisted
	 * _ddm.persist("user");
	 *
	 * // Register the "products" key to be persisted for 60 minutes
	 * _ddm.persist("user", 60);
	 *
	 * @function
	 * @name persist
	 * @param  {string} path - dot-notated path into the DD
	 * @param  {integer} [ttl=30] - Expiration in minutes
	 */
	_d.persist = function(path, ttl) {

		// Try so ddm errors can be caught and handed to a global error handler
		try {

			// ttl must be an integer, if not specified or not an integer, it will be 30 (minutes) by default.
			ttl = _d.isInteger(ttl) ? ttl : 30;

			// register change listeners if not registered before for this path
			if(!_pathsToPersist.hasOwnProperty(path)) {
				// Add two ChangeListeners to this path so that updates on the path, or anything below it, will
				// update the persistent storage.
				var persistenceListener = function(data) {
					_persist(path, data, _pathsToPersist[path]);
				};
				registerListener(path, persistenceListener, _persistenceListeners);
				registerListener(path+".**", persistenceListener, _persistenceListeners);
			}

			// Set the path to persist and it's TTL into the private _pathsToPersist property.
			_pathsToPersist[path] = ttl;

			// Persist the current value if it exists
			if(typeof getObjectAtPath(path) !== 'undefined')
				_persist(path, getObjectAtPath(path), ttl);

		// Catch errors and call global error handler
		}
		catch(e) {
			handleError(e, "persist", arguments);
		}
	};

	/**
	 * Unpersists a given path and removes any change listeners.
	 *
	 * @example
	 * // Unpersist the user key
	 * _ddm.unpersist("user");
	 *
	 * @function
	 * @name unpersist
	 * @param {string} path - Dot-notated path to unpersist
	 */
	_d.unpersist = function(path) {

		// Delete the handlers for this path from the persistence change listeners.
		delete _persistenceListeners[path];
		delete _persistenceListeners[path+".**"];

		// Unpersist the value in storage.
		_unpersist(path);
	};

	/**
	 * Sets a cookie with the given name and value. If a value is specified for days an expiry valye will be set for the cookie.
	 * The path of the cookie is defaulted to "/".
	 *
	 * @example
	 * // Create a cookie, valid across the entire site
	 * _ddm.setCookie('name', 'value');
	 *
	 * // Create a cookie that expires 7 days from now, valid across the entire site
	 * _ddm.setCookie('name', 'value', 7);
	 *
	 * // Create a cookie that expires 7 days from now, valid to the path of the current page
	 * _ddm.setCookie('name', 'value', 7, '' });
	 *
	 * @function
	 * @name setCookie
	 * @param {string} name - The name of the cookie to set.
	 * @param {string} value - The value of the cookie to set.
	 * @param {integer} days - The number of days until the cookie expires.
	 * @param {string} [path=/] - The path of the cookie. Defaults to "/"
	 * @param {string} [domain=.currentdomain.com] - The domain of the cookie. Defaults to the base of the current domain, including subdomains (leading dot), eg: .example.com
	 */
	_d.setCookie = function(name, value, days, path, domain) {

		try {
			// Default path to "/"
			if(typeof path === 'undefined') path = "/";

			// Default domain to root of current url
			if(typeof domain === 'undefined') domain = "." + getRootDomain();

			// Default expires to nothing (session cookie?)
			var expires = "";

			// If days are specified then calculate the expires value
			if(_d.isInteger(days)) {
				var date = new Date();
				date.setMilliseconds(date.getMilliseconds() + days * 864e+5);
				expires = "; expires=" + date.toUTCString();
			}

			// Encode the value
			value = encodeURIComponent(String(value)).replace(/%(23|24|26|2B|3A|3C|3E|3D|2F|3F|40|5B|5D|5E|60|7B|7D|7C)/g, decodeURIComponent);
			// Set the cookie.
			document.cookie = name + "=" + value + expires + ";domain=" + domain + ";path=" + path;
		}
		catch(e) {}
	};

	/**
	 * Gets a cookie with a given name.
	 *
	 * @example
	 * // Get a cookie with the name "userid"
	 * _ddm.getCookie("userid");
	 *
	 * @function
	 * @name getCookie
	 * @param  {string} cookieName - The name of the cookie.
	 * @return {string} The value of the cookie. Undefined if the cookie does not exist.
	 */
	_d.getCookie = function(cookieName) {
		try {
			var cookies = document.cookie ? document.cookie.split('; ') : [];
			var rdecode = /(%[0-9A-Z]{2})+/g;

			for (var i = cookies.length; i-- > 0; ) {
				var parts = cookies[i].split('=');
				var cookie = parts.slice(1).join('=');

				// Cut possible quotes
				if (cookie.charAt(0) === '"') {
					cookie = cookie.slice(1, -1);
				}

				// Correctly parse the name and cookie value (URI Encoded stuff)
				try {
					var name = parts[0].replace(rdecode, decodeURIComponent);
					cookie = cookie.replace(rdecode, decodeURIComponent);

					// If the name matches return the cookie value
					if(cookieName === name) {
						return cookie;
					}
				}
				catch (e) {}
			}
		}
		catch(e) {
			return;
		}
	};

	/**
	 * Removes a cookie with the given name.
	 *
	 * @example
	 * // Delete cookie
	 * _ddm.removecookie("name");
	 *
	 * // Delete cookie for a given path
	 * _ddm.removecookie("name", "/path");
	 *
	 * @function
	 * @name removeCookie
	 * @param  {string} name - The name of the cookie to remove.
	 */
	_d.removeCookie = function(name, path) {
		_d.setCookie(name, "", -100, path);
	};

	/**
	 * Checks if a cookie exists.
	 *
	 * @example
	 * // Check if a cookie with the name "userid" exists
	 * if(_ddm.cookieExists("userid")) {
	 *     // ... do something
	 * }
	 *
	 * @function
	 * @name cookieExists
	 * @param  {string} name - The name of the cookie.
	 * @return {string} True if a cookie with the given name exists. False otherwise.
	 */
	_d.cookieExists = function(name) {
		return typeof _d.getCookie(name) !== "undefined";
	};

	/**
	 * Returns the value of a parameter in the HTTP URL string of the current URL.
	 *
	 * @example
	 * // Retrieve the userid parameter (With an example URL query string of ?userid=123&product=tv)
	 * var userid = _ddm.getUrlParam("userid");
	 *
	 * @function
	 * @name getUrlParam
	 * @param  {string} paramName - The name of the parameter to search for.
	 * @return {string} The value of the parameter or an empty string if the parameter does not exist.
	 */
	_d.getUrlParam = function(paramName) {
		return getParam(window.location.href, paramName);
	};

	/**
	 * Returns the value of a parameter in the HTTP Referer URL string.
	 *
	 * @example
	 * // Retrieve the parameter named "productId" from the URL string of the refering page.
	 * _ddm.getRefParam("productId");
	 *
	 * @function
	 * @name getRefParam
	 * @param  {string} paramName - The name of the parameter to search for.
	 * @return {string} The value of the parameter or an empty string if the parameter does not exist.
	 */
	_d.getRefParam = function(paramName) {
		return getParam(document.referrer, paramName);
	};

	/**
	 * Checks whether a given object is in fact an Object
	 *
	 * @example
	 * // Initialize an object
	 * var obj = {};
	 *
	 * // Test if it is an object
	 * if(_ddm.isObject(obj)) {
	 *     // ... this will be executed as obj is indeed an object.
	 * }
	 *
	 * @function
	 * @name isObject
	 * @param  {*} obj - The object to test
	 * @return {Boolean} True or false if the object is in fact an object.
	 */
	_d.isObject = function (obj) {
		return (Object.prototype.toString.call(obj) === '[object Object]' && !!obj);
	};

	/**
	 * Checks whether a given object is in fact an Array
	 *
	 * @example
	 * // Initialize an array
	 * var arr = [];
	 *
	 * // Test if it is an array
	 * if(_ddm.isArray(arr)) {
	 *     // ... this will be executed as arr is indeed an array.
	 * }
	 *
	 * @function
	 * @name isArray
	 * @param  {*} obj - The object to test
	 * @return {Boolean} True or false if the object is in fact an Array.
	 */
	_d.isArray = function (obj) {
		return Object.prototype.toString.call(obj) === '[object Array]';
	};

	/**
	 * Checks whether a given object is an Integer
	 *
	 * @example
	 * // Initialize an integer
	 * var i = 1;
	 *
	 * // Test if it is an integer
	 * if(_ddm.isInteger(i)) {
	 *     // ... this will be executed as i is indeed an integer.
	 * }
	 *
	 * @function
	 * @name isInteger
	 * @param  {*} obj - The object to test
	 * @return {Boolean} True or false if the object is in fact an Integer.
	 */
	_d.isInteger = function(obj) {
		return typeof obj === 'number' && isFinite(obj) && Math.floor(obj) === obj;
	};

	/**
	 * Checks whether a given object is a String
	 *
	 * @example
	 * // Initialize a string
	 * var s = "I am a string"1;
	 *
	 * // Test if it is a string
	 * if(_ddm.isString(s)) {
	 *     // ... this will be executed as s is indeed a string.
	 * }
	 *
	 * @function
	 * @name isString
	 * @param  {*} obj - The object to test
	 * @return {Boolean} True or false if the object is in fact a string.
	 */
	_d.isString = function(obj) {
		return (typeof obj === 'string' || obj instanceof String);
	};

	/**
	 * Checks whether a given object is an empty object
	 *
	 * @function
	 * @name isEmptyObject
	 * @param  {*} obj - The object to test
	 * @return {Boolean} True or false if the object is in fact an empty object.
	 */
	_d.isEmptyObject = function(obj) {
		if (!obj || obj == null || typeof obj === 'undefined') return true;
		if (_d.isObject(obj)) return JSON.stringify(obj) === JSON.stringify({});
		if (_d.isArray(obj)) return obj.length == 0;
		if (_d.isString(obj)) return obj.trim() === '';
		return !_d.isInteger(obj);
	};

	/**
	 * Method to clone an object using JSON (de)serialization.
	 *
	 * @example
	 * // Create object B as a clone of object a
	 * var a = { "key": "value" };
	 * var b = _ddm.cloneObject(a);
	 *
	 * // ... B is now a clone of A. The objects are independent of another so changing properties in A does not change object B and vice versa.
	 *
	 * @function
	 * @name cloneObject
	 * @param {object} obj - The object to clone.
	 */
	_d.cloneObject = function(obj) {

		if(typeof obj === "undefined")
			return;

		// Try so ddm errors can be caught and handed to a global error handler
		try {
			return JSON.parse(JSON.stringify(obj));

		// Catch errors and call global error handler
		}
		catch(e) {
			handleError(e, "cloneObject", arguments);
		}
	};

	/* PRIVATE FUNCTIONS */

	/**
	 * Returns a parameter from a given URL String. If multiple parameters with the same
	 * name are present within the sourceString, the first value will be returned. If
	 * the parameter name is not found it returns an empty string.
	 *
	 * @private
	 * @param  {string} sourceString - The URL String to search the parameter in.
	 * @param  {string} paramName - The name of the parameter to search for.
	 * @return {string} The value of the parameter or an empty string if the parameter is not found.
	 */
	var getParam = function(sourceString, paramName) {
		if (!paramName)
			return "";
		paramName = paramName.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
		var found = RegExp("[\\?\x26]" + paramName + "\x3d([^\x26#]*)").exec(sourceString);
		return found === null  ? "" : found[1];
	};

	/**
	 * Sets an object in the DD at a given path. If an object already exists at the given path, it
	 * will be merged. Existing keys in both objects will be overwritten by the values in the
	 * object that was provided.
	 *
	 * @private
	 * @function
	 * @name setObjectAtPath
	 * @param {string} path - The dot notated path of the object/property that must be stored
	 * @param {*} value - The value that must be stored
	 */
	var setObjectAtPath = function(path, value) {

		// Clone to make sure no circular references are created within _dd
		value = _d.cloneObject(value);

		// Use the array reduce method to loop over the path. The prev value starts at the root of the DD object.
		return path.split('.').reduce(function (prev, cur, idx, arr) {

			// If we are at the last node in the path, then we need to store things. If the last node in the path
			// already exists as an object and the provided value is also an object, then they need to be merged.
			// Otherwise we can simply set the last node in the path to the provided value.
			if (idx === arr.length - 1) return _d.isObject(prev[cur]) && _d.isObject(value) ? _d.mergeObjects(prev[cur], value) : prev[cur] = value;

			// If we are not at the last node of the path, return the object at the current node. If however the
			// object at the current node is not an object, initialize it as an empty object. This way, objects
			// are instantiated automatically for parent nodes if they do not exist yet.
			return (_d.isObject(prev[cur])) ? prev[cur] : (prev[cur] = {});
		}, window._dd);
	};

	/**
	 * Retrieves an object at a given path within a provided object. If no object is provided, it will default to
	 * the DD object.
	 *
	 * @private
	 * @function
	 * @name getObjectAtPath
	 * @param {string} path - The dot notated path of the object/property that must be retrieved
	 * @param {object} [obj=window._dd] - The object that we want to find the object/property in. Defaults to window._dd
	 * @return {object} The found object/property, or undefined.
	 */
	var getObjectAtPath = function(path, obj) {
		obj = typeof obj !== undefined ? obj : window._dd;
		return path == "" ? obj : path.split('.').reduce(function(prev, cur) {
			return (prev !== undefined) ? prev[cur] : undefined;
		}, obj);
	};

	/**
	 * Method to clone the current DD object to the private _prev_dd variable.
	 *
	 * @private
	 * @function
	 * @name cloneDDtoPreviousDD
	 */
	var cloneDDtoPreviousDD = function () {
		_prev_dd = _d.cloneObject(window._dd);
	};

	/**
	 * Compares the current DD to the previous DD and invokes the changeListeners
	 * that are interested in the changes
	 *
	 * @private
	 * @function
	 * @name invokeChangeListeners
	 */
	var invokeChangeListeners = function() {
		// Invoke the listeners for persistence listeners
		var invokedPersistenceListeners = invokeChangeListenersForListenerSet(_persistenceListeners);

		// Invoke the listeners for property change listeners
		var invokedChangeListeners = invokeChangeListenersForListenerSet(_propertyListeners);

		// Concat the invoked listeners arrays and return them
		return invokedPersistenceListeners.concat(invokedChangeListeners);
	};

	/**
	 * Method to provide the same functionality of invoking listeners to different
	 * sets of registered listeners. This is used so that change listeners and persistence
	 * listeners can both be registered, invoked and unregistered independently.
	 *
	 * @private
	 * @function
	 * @name invokeChangeListenersForListenerSet
	 * @param {object} listenerSet - Object with listener definitions.
	 * @return {array} An array with all handlers that have been invoked.
	 */
	var invokeChangeListenersForListenerSet = function(listenerSet) {

		// Retrieve all paths that are different between the previous DD and the current DD
		var differences = getDifferences(_prev_dd, window._dd);

		// Reverse the paths so that deeper nodes are handled first and wildcard listeners
		// will be triggered on the deepest node that changed instead of the earliest node
		// it matches.
		differences.reverse();

		// This object will hold handlers that have already been invoked so they are not
		// invoked twice (path based).
		var invokedListeners = {};

		// This array will hold all invoked handlers. This will be returned to the caller.
		var invokedFunctions = [];

		// Loop through the different paths
		for(var d=0; d<differences.length; d++) {

			// Get changeListeners for this path.
			var listeners = getListeners(differences[d], listenerSet);

			// Loop through the found listeners.
			for(var l=0; l<listeners.length; l++){

				var invokePath = listeners[l].path;

				// If the listener has not been invoked before, invoke it now.
				if(!invokedListeners.hasOwnProperty(invokePath)) {

					// Loop through the registered listeners for this path and invoke them
					for(var h=0; h<listeners[l].handlers.length; h++) {

						// Invoke the listener and provide the current data.
						try {
							if(!listeners[l].handlers[h].hasOwnProperty("once") && listeners[l].handlers[h].handler(getObjectAtPath(invokePath.replace(/\.?\*\*?$/, ""), window._dd)) === true) {
								listeners[l].handlers[h].once = true;
							}
						}
						catch(e) {
							handleError(e, "listener-changehandler", '', listeners[l].handlers[h].id);
						}

						invokedFunctions.push(listeners[l].handlers[h].handler);
					}

					// Store the invokePath in the invokedListeners object so we can check
					// whether the listeners for this path have already been invoked.
					invokedListeners[invokePath] = 1;
				}
			}
		}

		return invokedFunctions;
	};

	/**
	 * Registers an event listener for a given path in the provided listeners object.
	 * The listeners object is an object with a simple key/value structure, where the
	 * key is the path and the value is an array of listeners for that path.
	 *
	 * When the exact same handler is already registered for the exact same path, it will not be
	 * registered again.
	 *
	 * If dependsOn is provided this means that the handler may only be invoked if all
	 * events in the dependsOn array have been triggered before.
	 *
	 * @private
	 * @function
	 * @name registerListener
	 * @param  {(string|string[])} path - The path(s) to add the listener for
	 * @param  {function} handler - The handler function to be invoked
	 * @param  {object} listeners - The object that holds all listeners
	 * @param  {string[]} dependsOn- Array of paths this listener depends on.
	 * @param  {string} id - A string by which the handler can be identified. Can be used for debugging purposes.
	 * @return {boolean} Boolean to indicate whether the registration was done or not.
	 */
	var registerListener = function(path, handler, listeners, dependsOn, id) {

		// If dependsOn is a string, then it's a listener that does not depend on anything but DID provide an ID for the handler
		if(_d.isString(dependsOn)) {
			id = dependsOn;
			dependsOn = undefined;
		}

		// Retrieve the array of already registered listeners for the given path, or initialize it as an empty array.
		var l = listeners.hasOwnProperty(path) ? listeners[path] : [];

		// Test if the same handler is not already registered for the given path. If so, do not register again.
		for (var i = l.length; i-- > 0; ) if(l[i] === handler) return false;

		// Add the current handler to this array of listeners.
		l.push({'handler':handler,'id': id, 'dependsOn':dependsOn});

		// Set the array of listeners (that now holds our new listener) into the listeners object using the path
		// as the key.
		listeners[path] = l;

		// Return true to indicate that the registration of the handler for the path was done.
		return true;
	};

	/**
	 * Method to get listeners for a given path. This method is used to get listeners that listen to changes
	 * in the DD, as well as listeners for events by name.
	 *
	 * @private
	 * @function
	 * @name getListeners
	 * @param  {string} path - Dot notated path to get the listeners for.
	 * @param  {object} listeners - The listeners object to inspect for listeners
	 * @return {array} Array of functions of the listeners that were found.
	 */
	var getListeners = function(path, listenersToInspect) {

		// If we have a listener for everything underneath the root (**) then add the listeners of that to the resulting listeners array.
		var listeners = (listenersToInspect.hasOwnProperty("**") ? [{path:"**", handlers:listenersToInspect["**"]}] : []);

		// Loop through the path using array reduce to add more listeners for all possible paths.
		path.split('.').reduce(function(prev, cur, idx, arr) {

			// If we're at the last node of the path, add listeners for the complete path as well as any listeners to nodes on the same level
			var pStar;
			if(idx === arr.length - 1) {
				pStar = prev.concat(['*']).join('.');
				var pFull = prev.concat([cur]).join('.');
				listeners = listeners.concat(listenersToInspect.hasOwnProperty(pStar) ? [{path:pStar, handlers:listenersToInspect[pStar]}] : []);
				listeners = listeners.concat(listenersToInspect.hasOwnProperty(pFull) ? [{path:pFull, handlers:listenersToInspect[pFull]}] : []);
			}
			// If we're not at the last node of the path, try to find listeners that listen to changes deeper than the current path.
			else {
				pStar = prev.concat([cur, '**']).join('.');
				listeners = listeners.concat(listenersToInspect.hasOwnProperty(pStar) ? [{path:pStar, handlers:listenersToInspect[pStar]}] : []);
			}

			// prev initially starts as []. Each iteration we are adding the current node in the path (cur) so that
			// we can easily recreate the path up until that point.
			prev.push(cur);

			// Return the prev array so in the next iteration the prev value will be the array of path nodes up until where we currently are.
			return prev;
		}, []);

		// Reverse the listeners as we have added them from root to deepest level, and we want to bubble up from deepest node upwards.
		listeners.reverse();

		return listeners;
	};

	/**
	 * Method to check if storage is available.
	 *
	 * @private
	 * @function
	 * @name storageAvailable
	 * @return {boolean} True or false whether storage is available or not.
	 */
	var storageAvailable = function() {
		try {
			var x = '__storage_test__';
			storage.setItem(x, x);
			storage.removeItem(x);
			return true;
		}
		catch(e) {
			return e instanceof DOMException && (e.code === 22 || e.code === 1014 || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') && storage.length !== 0;
		}
	};

	/**
	 * Method to persist a key/value pair for a specific period of time.
	 *
	 * @private
	 * @function
	 * @name _persist
	 * @param  {string} key - The key under which to persist
	 * @param  {object} value - The value to persist. Must be serializable into JSON.
	 * @param  {integer} [ttl=30] - Number of minutes to persist the value
	 */
	var _persist = function(key, value, ttl) {

		// ttl must be an integer, if not specified or not an integer, it will be 30 (minutes) by default.
		ttl = _d.isInteger(ttl) ? ttl : 30;

		// Only proceed if storage is actually available.
		if(storageAvailable()) {

			try {
				// Construct the necessary vars
				var now = new Date().getTime();
				var storageKey = storagePrefix + key;
				var storageValue = JSON.stringify(value);
				var expiresKey = storageExpirationPrefix + key;
				var expiresValue = new Date(now + ttl * 60000).getTime();

				// If the key/value pair has not expired yet, then store it.
				if(now < expiresValue) {
					storage.setItem(storageKey, storageValue);
					storage.setItem(expiresKey, expiresValue);
				}
				// Key/value is past expiration, so remove it.
				else {
					storage.removeItem(storageKey);
					storage.removeItem(expiresKey);
				}
			}
			catch(e) {}
		}
	};

	/**
	 * Method to unpersist a key.
	 *
	 * @private
	 * @function
	 * @name _unpersist
	 * @param {string} key - The key to unpersist
	 */
	var _unpersist = function(key) {
		// Simply call _persist with a TTL of 0.
		_persist(key, null, 0);
	};

	/**
	 * Method that is called during initialization of the DDM. This restores
	 * all the persisted DD properties that have not expired yet and re-registers
	 * them to be persistent so that future changes will update the currently persisted
	 * values.
	 *
	 * @private
	 * @function
	 * @name restorePersistedDD
	 */
	var restorePersistedDD = function() {
		// Only proceed if storage is actually available.
		if(storageAvailable()) {

			try {
				// Defined now
				var now = new Date().getTime();

				// Loop through all keys in storage
				for (var key in storage) {

					// If we find an expiration key
					if(key.lastIndexOf(storageExpirationPrefix, 0) === 0) {

						// Construct the DD key by removing the expiration prefix
						var ddKey = key.replace(storageExpirationPrefix, '');

						// If the storage has a key for the value as well, and the TTL has not expired, restore the value
						if(storage.hasOwnProperty(storagePrefix + ddKey) && parseInt(storage[key], 10) > now) {
							setObjectAtPath(ddKey, JSON.parse(storage[storagePrefix + ddKey]));

							// Set the path to be persistent again, but only if it is not already defined as a persisted path.
							// It could for instance be a predefined persistent path of which we do not want to overwrite the
							// TTL that is set for this path nor it's already registered change handlers.
							if(!_pathsToPersist.hasOwnProperty(ddKey)) {
								_d.persist(ddKey);
							}
						}
						// Otherwise, remove the keys as they have expired.
						else {
							storage.removeItem(key);
							storage.removeItem(storagePrefix + ddKey);
						}
					}

					// Remove if deserialization ends up as a string with value 'undefined'
					if(/dd_p_.*/.test(key) && storage.getItem(key) == 'undefined'){
						storage.removeItem(key);
					}
				}
			}
			catch(e) {}
		}
	};

	/**
	 * Deep merge a source object into a destination object, modifying the destination object.
	 *
	 * @function
	 * @name mergeObjects
	 * @param  {object} destination - The destination object where to merge into.
	 * @param  {object} source - The source object that needs to be merged into the destination object.
	 * @return {object} The destination object
	 */
	_d.mergeObjects = function(destination, source) {
		// loop through the source object's property names
		for (var property in source) {
			// If the current property being looped through is an object
			if (_d.isObject(source[property])) {
				// we need to make sure the destination has an object with the same property name, so
				// either use the existing one in the destination if it has it, or initialize it with
				// an empty object.
				destination[property] = _d.isObject(destination[property]) ? destination[property] : {};

				// Recursively go into the source object.
				arguments.callee(destination[property], source[property]);
			}
			// If the current property is not an object, it is a value to be set, so set it in the
			// destination object.
			else {
				destination[property] = _d.cloneObject(source[property]);
			}
		}
		return destination;
	};

	/**
	 * Returns an array of dot-notated paths of differences between two objects. This method
	 * calls itself recursively to dig deeper into the objects. The differences and path
	 * arguments are used when the method is called recursively.
	 *
	 * @private
	 * @function
	 * @name getDifferences
	 * @param  {object} obj1 - Object that needs to be compared
	 * @param  {object} obj2 - Object that needs to be compared
	 * @return {array} Array of dot-notated strings of differences between the provided objects.
	 */
	var getDifferences = function(obj1, obj2) {

		/*
			Since the private _getDifferences function recursively loops over the properties in
			obj2, it will miss out on properties that are available in obj1, but are not present
			in obj2. To make sure we get all differences, we call _getDifferences twice so that
			it loops through the properties of both objects. This makes sure we have all the
			differences between them.
		 */
		var dif1 = _getDifferences(obj1, obj2);
		var dif2 = _getDifferences(obj2, obj1);

		// Now that we have all differences, concatenate them into one array.
		var all = dif1.concat(dif2);

		// The concatenation of the two arrays can result in duplicate entries, so de-duplicate.
		var result = [];
		var differences = {};

		// Loop through all entries.
		for (var i = all.length; i-- > 0; ) {
			var difference = all[i];
			// if we do not have this difference yet, add it to the final result
			if(!differences.hasOwnProperty(difference)) {
				differences[difference] = true;
				result.push(difference);
			}
		}

		return result;
	};

	/**
	 * Returns an array of dot-notated paths of differences between two objects. This method
	 * calls itself recursively to dig deeper into the objects. The differences and path
	 * arguments are used when the method is called recursively. To get a complete list of
	 * differences, this method needs to be called twice with reversed order of objects, as
	 * it loops through the properties of obj2, so properties that are present in obj1 but
	 * not in obj2 will not get picked up in one run. Therefor, this function is private
	 * and is being called twice by the public getDifferences function. Possible duplicates
	 * are also filtered out in the getDifferences function.
	 *
	 * @private
	 * @function
	 * @name getDifferences
	 * @param  {object} obj1 - Object that needs to be compared
	 * @param  {object} obj2 - Object that needs to be compared
	 * @param  {array} [differences=[]] - Array of found differences. Used internally
	 * @param  {array} [path=[]] - Array of separated elements of the dot-notated path currently being checked.
	 * @return {array} Array of dot-notated strings of differences between the provided objects.
	 */
	var _getDifferences = function(obj1, obj2, differences, path) {
		differences = _d.isArray(differences) ? differences : [];
		path = _d.isArray(path) ? path : [];

		// Loop through the current level within object 2
		for (var prop in obj2) {

			// If the current property within the current level of object 2 is an object itself
			// we need to dig deeper.
			if (_d.isObject(obj2[prop])) {

				// Get the same property within object 1, or undefined if it does not exist
				var obj1Prop = (_d.isObject(obj1) && obj1.hasOwnProperty(prop) ? obj1[prop] : undefined);

				// push the current property name into the path array so we can easily construct
				// paths during recursive method calling.
				// path.push(prop);

				// If the same property within object 1 does not exist, register a difference
				if(typeof obj1Prop === 'undefined') {
					differences.push(path.concat([prop]).join('.'));
				}

				// Recursively call this method as the current property within object 2 was an object itself.
				_getDifferences(obj1Prop, obj2[prop], differences, path.concat([prop]));
			}

			// The current property is not an object
			else {
				// In that case, check if the same property within object 1 is the same. If not, register a difference.
				// Comparison of the property within object 1 and object 2 is done by comparing their JSON representations
				// so that deeper levels and arrays can be compared.
				if(!_d.isObject(obj1) || JSON.stringify(obj1[prop]) !== JSON.stringify(obj2[prop])) {
					differences.push(path.concat([prop]).join('.'));
				}
			}
		}

		// Return the currently collected differences.
		return differences;
	};

	/**
	 * Convenience function to determine if an array has a certain value.
	 *
	 * @param  {array} arr - The array to search through
	 * @param  {any} value - The value to search for
	 * @return {boolean} True if it finds the value in the array. False otherwise.
	 */
	var _arrayHasValue = function(arr, value) {
		for (var i = arr.length; i-- > 0; )
			if (arr[i] === value)
				return true;
		return false;
	};

	// Trim polyfill
	if (!String.prototype.trim) {
		(function() {
			var rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g;
			String.prototype.trim = function() {
				return this.replace(rtrim, '');
			};
		})();
	}

	var getRootDomain = function() {
		var domain = window.location.hostname,
		splitArr = domain.split('.'),
		arrLen = splitArr.length;
		if (arrLen > 2) {
			domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
			if (splitArr[arrLen - 1].length == 2 && splitArr[arrLen - 2].length == 2) {
				domain = splitArr[arrLen - 3] + '.' + domain;
			}
		}
		return domain;
	};

	// Get the current window._ddm value as it may already contain a trigger and events array, prior to DDM being loaded.
	var current_ddm = window._ddm;

	// The current_ddm already seems to be a fully loaded ddm (it has an events array) so do nothing. Someone probably just loaded it twice.
	if(_d.isObject(current_ddm) && _d.isArray(current_ddm.events)) {
		return;
	}

	/**
	 * This is the DigitalData object. Values can be retrieved from this directly, but
	 * it's recommended to use the _ddm.get() method to retrieve data.
	 *
	 * @type {Object}
	 */
	window._dd = {};

	// Call the method to restore the currently persisted values in storage.
	restorePersistedDD();

	// When there is a current_ddm and it has listeners and events in the form of L and E properties.
	if(_d.isObject(current_ddm) && _d.isArray(current_ddm.l) && _d.isArray(current_ddm.e)) {

		// Register the listeners by passing the previously stored arguments
		for (var l = current_ddm.l.length; l-- > 0; )
			_d.listen.apply(_d, current_ddm.l[l]);

		// Trigger the events in this fully loaded DDM
		for (var e = 0; e < current_ddm.e.length; e++)
			_d.trigger.apply(_d, current_ddm.e[e]);
	}

	// Set window._ddm to our now fully initialized _d object
	window._ddm = _d;
})();
