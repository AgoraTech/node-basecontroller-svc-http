/**
 * @fileoverview
 * @author michalcz
 *
 * Starts the JSON HTTP feature in Base Controller
 */

var HttpServer = require('basecontroller-http').HttpServer,
	logger = require('basecontroller-logger').getInstance('HTTPService'),
    url = require('url');

/**
 *
 * @context BaseController
 * @param {Function} callback
 */
module.exports = function(config, callback) {

    this._server = new HttpServer({
        port: config.port,
        timeout: config.timeout
    }, requestHandler.bind(this), function(error) {
        if (error) this.logger.error('HTTP service error', error);
        else this.logger.log('HTTP service started at ' + config.port);
        callback();
    }.bind(this));

    // backward compatibility
    this.http = this._server.nativeServer();

    this.addCleanup(shutdown.bind(this));
};

var shutdown = function(callback, graceful) {
    if (!graceful) return callback();

    this.logger.log("Shutting down HTTP service and closing all connections");
    var now = Date.now();

    this._server.close(function(error) {
        if (error) this.logger.warn("HTTP Service was not working", error);
        else this.logger.log("HTTP Service has been shut down in " + (Date.now() - now) + " ms.");
        callback();
    }.bind(this));

};

var requestHandler = function (request, response) {

    var ref = this,
        req = url.parse(request.url),
        path = req.pathname || '/',
        callback = false,
        base = path.replace(/^\/|\/.*/g, '');

    var context = {
        headers: {
            'Content-Type': 'text/javascript'
        },
        request: request,
        response: response,
        method: request.method,
        location: req,
        host: request.headers.host,
        selfHandled: false
    };

    if ('origin' in request.headers) {
        context.headers['Access-Control-Allow-Origin'] = request.headers.origin;
        context.headers['Access-Control-Allow-Credentials'] = 'true';
    }

    context.request_cookies = {};
    request.headers.cookie && request.headers.cookie.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        context.request_cookies[ parts[ 0 ].trim() ] = ( parts[ 1 ] || '' ).trim();
    });

    req.strippedPath = path.replace(/^\/?[^\/]+/, '');

    var data = '';

    request.addListener("data", function(chunk) {
        data += chunk;
    });

    request.addListener("end", function() {
        try {
            if (request.method == 'OPTIONS'){
                response.writeHead(200, BaseController.parseHeaders(context));
                response.end('');
                return;
            }

            var supported = ref._handleRequest('http', base, req, data, context, function(obj) {

            	if (context.selfHandled) {
            		logger.debug('request is selfhandled');
            		return;
            	}

                var headers = parseHeaders(context), r = 'null';

                var status = (obj instanceof Error) && (obj.status || 500) || 200;

                response.writeHead(status, headers);

                if (context.plainText) {
                    logger.debug('Sending plaintext response');
                    response.end(obj);
                    return;
                }

                if (callback) response.write(callback + '(');

                try {
                    if (obj === undefined) {
                        r = 'undefined';
                    } else if (obj instanceof Error) {
                        r = JSON.stringify({
                            "error": obj.status || 500,
                            "message": obj.message,
                            "msg": obj.msg,
                            "stack": obj.stack || false
                        });
                        logger.debug('Handler returned an error: ', obj);
                    } else if (obj instanceof Object) {
                        r = JSON.stringify(obj) + '';
                    } else {
                        r = '"' + obj.toString() + '"';
                    }
                } catch(e) {
                    logger.debug('Response Parse Error', e);
                }

                response.write(r);
                if (callback) response.write(');');

                response.end('\n');
            });

            if (!supported) {
                response.writeHead(404, parseHeaders(context));
                response.write('{"error": 404, "message": "Operation not supported!"}');
                response.end('\n');

                logger.debug('No handler for ' + base);
            };

        } catch (e) {
            response.writeHead(e.status || 500, parseHeaders(context));
            logger.debug('Error', e);
            response.write(JSON.stringify({
                "error": e.status || 500,
                "message": e.message
            }));
            response.end('\n');
        }
    });
};

var parseHeaders = function(context) {
    var headers = [];
    for (var i in context.headers) {
        if (context.headers[i] instanceof Array) {
            for (var j=0; j<context.headers[i].length; j++) {
                headers.push([i, context.headers[i][j]]);
            }
        } else {
            headers.push([i, context.headers[i]]);
        }
    }
    return headers;
};

