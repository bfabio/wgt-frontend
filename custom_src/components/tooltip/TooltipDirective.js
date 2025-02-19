goog.provide('ga_tooltip_directive');

goog.require('ga_browsersniffer_service');
goog.require('ga_debounce_service');
goog.require('ga_map_service');

goog.require('ga_popup_service');
goog.require('ga_styles_service');
goog.require('ga_topic_service');

//+++START+++
goog.require('ga_urlutils_service');
//+++END+++

(function () {

    var module = angular.module('ga_tooltip_directive', [
        'ga_debounce_service',
        'ga_popup_service',
        'ga_map_service',
        'ga_styles_service',
        'ga_time_service',
        'pascalprecht.translate',
        'ga_topic_service',
        'ga_urlutils_service',
        'ui.bootstrap'
    ]);

    module.directive('gaTooltip',
        function ($timeout, $http, $q, $translate, $sce, gaPopup, gaLayers,
                  gaBrowserSniffer, gaDefinePropertiesForLayer, gaMapClick, gaDebounce,
                  gaPreviewFeatures, gaStyleFactory, gaMapUtils, gaTime, gaTopic, gaPermalink
                  //+++START+++
            , gaUrlUtils
                  //+++END+++
            , gaGlobalOptions
        ) {
            var popupContent =
                '<div ng-repeat="htmlsnippet in options.htmls">' +
                '<div ng-mouseenter="options.onMouseEnter($event,' +
                'options.htmls.length)" ' +
                'ng-mouseleave="options.onMouseLeave($event)" ' +
                'ng-bind-html="htmlsnippet"></div>' +
                '<div class="ga-tooltip-separator" ' +
                'ng-show="!$last"></div>' +
                '</div>';
            // Test if the layer is a vector layer
            var isVectorLayer = function (olLayer) {
                return (olLayer instanceof ol.layer.Vector ||
                    (olLayer instanceof ol.layer.Image &&
                        olLayer.getSource() instanceof ol.source.ImageVector));
            };

            // Test if the layer has a tooltip
            var isQueryableBodLayer = function (olLayer) {
                var bodId = olLayer.bodId;
                if (bodId) {
                    bodId = gaLayers.getLayerProperty(bodId, 'parentLayerId') || bodId;
                }
                //---START---
                //return (bodId &&  gaLayers.getLayerProperty(bodId, 'tooltip'));
                //---END---
                //+++START+++
                return (bodId && gaLayers.getLayerProperty(bodId, 'selectbyrectangle'))
                //+++END+++;
            };

            // Get all the queryable layers
            // @brez: identify rettangolo non passa da questa funzione
            var getLayersToQuery = function (map) {
                var layersToQuery = [];
                var actualScale = gaGlobalOptions.scales[map.getView().getZoom()];
                map.getLayers().forEach(function (l) {
                    var minScale = gaLayers.getLayerProperty(l.bodId, 'minscale');
                    var maxScale = gaLayers.getLayerProperty(l.bodId, 'maxscale');

                    //if minScale is not null and layer minScale is gt map actualScale don't identify features for this layer
                    if (minScale !== 0 && minScale > actualScale) {
                        //if maxScale is not null and layer maxScale is lt map actualScale don't identify features for this layer
                    } else if (maxScale !== 0 && maxScale < actualScale) {


                    } else if (l.bodId && l.visible && !l.preview &&
                        (isQueryableBodLayer(l) || isVectorLayer(l))) {
                        layersToQuery.push(l);
                    }
                });
                return layersToQuery;
            };

            // Return a year as number from a timestamp string
            var yearFromString = function (timestamp) {
                if (timestamp && timestamp.length) {
                    timestamp = parseInt(timestamp.substr(0, 4));
                    if (timestamp <= new Date().getFullYear()) {
                        return timestamp;
                    }
                }
            };

            // Test if a feature is queryable.
            var isFeatureQueryable = function (feature) {
                return feature && feature.get('name') || feature.get('description');
            };

            // Find the first feature from a vector layer
            var findVectorFeature = function (map, pixel, vectorLayer) {
                var featureFound;
                map.forEachFeatureAtPixel(pixel, function (feature, layer) {
                    // vectorLayer is defined when a feature is clicked.
                    // onclick
                    if (layer) {
                        if (!vectorLayer || vectorLayer == layer) {
                            if (!featureFound && isFeatureQueryable(feature)) {
                                featureFound = feature;
                            }
                        }
                    }
                });
                return featureFound;
            };

            // Change cursor style on mouse move, only on desktop
            var updateCursorStyle = function (map, pixel) {
                // var feature;
                // var hasQueryableLayer = false;
                // if (!gaBrowserSniffer.msie || gaBrowserSniffer.msie > 10) {
                //     hasQueryableLayer = map.forEachLayerAtPixel(pixel,
                //         function () {
                //             return true;
                //         },
                //         undefined,
                //         function (layer) {
                //             return isQueryableBodLayer(layer);
                //         });
                // }
                // if (!hasQueryableLayer) {
                //     feature = findVectorFeature(map, pixel);
                // }
                // map.getTarget().style.cursor = (hasQueryableLayer || feature) ?
                //     'pointer' : '';
            };
            var updateCursorStyleDebounced = gaDebounce.debounce(
                updateCursorStyle, 10, false, false);

            // Register click/touch/mousemove events on map
            var deregMapEvents = angular.noop;
            var registerMapEvents = function (scope, onClick) {
                if (deregMapEvents !== angular.noop) {
                    return;
                }
                var map = scope.map;
                var onMapClick = function (evt) {
                    var coordinate = (evt.originalEvent) ?
                        map.getEventCoordinate(evt.originalEvent) :
                        evt.coordinate;

                    // A digest cycle is necessary for $http requests to be
                    // actually sent out. Angular-1.2.0rc2 changed the $evalSync
                    // function of the $rootScope service for exactly this. See
                    // Angular commit 6b91aa0a18098100e5f50ea911ee135b50680d67.
                    // We use a conservative approach and call $apply ourselves
                    // here, but we instead could also let $evalSync trigger a
                    // digest cycle for us.

                    scope.$applyAsync(function () {
                        onClick(coordinate);
                    });
                };
                var deregMapClick = gaMapClick.listen(map, onMapClick);
                var deregPointerMove;
                if (!gaBrowserSniffer.mobile) {
                    deregPointerMove = map.on('pointermove', function (evt) {
                        updateCursorStyleDebounced(map, evt.pixel);
                    });
                }
                deregMapEvents = function () {
                    deregMapClick();
                    ol.Observable.unByKey(deregPointerMove);
                    deregMapEvents = angular.noop;
                };
            };

            // Register leftclick event on globe
            var deregGlobeEvents = angular.noop;
            var registerGlobeEvents = function (scope, onClick) {
                if (deregGlobeEvents != angular.noop) {
                    return;
                }
                var scene = scope.ol3d.getCesiumScene();
                var ellipsoid = scene.globe.ellipsoid;
                var handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
                handler.setInputAction(function (evt) {
                    var cartesian = olcs.core.pickOnTerrainOrEllipsoid(scene,
                        evt.position);
                    if (cartesian) {
                        var cartographic = ellipsoid.cartesianToCartographic(cartesian);
                        var coordinate = ol.proj.transform([
                            Cesium.Math.toDegrees(cartographic.longitude),
                            Cesium.Math.toDegrees(cartographic.latitude)
                        ], 'EPSG:4326', scope.map.getView().getProjection());
                    }
                    scope.$applyAsync(function () {
                        onClick(coordinate, evt.position);
                    });
                }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
                deregGlobeEvents = function () {
                    if (!handler.isDestroyed()) {
                        handler.removeInputAction(
                            Cesium.ScreenSpaceEventType.LEFT_CLICK);
                        handler.destroy();
                        deregGlobeEvents = angular.noop;
                    }
                };
            };

            return {
                restrict: 'A',
                scope: {
                    map: '=gaTooltipMap',
                    ol3d: '=gaTooltipOl3d',
                    options: '=gaTooltipOptions',
                    isActive: '=gaTooltipActive'
                },
                link: function (scope, element, attrs) {
                    var htmls = [],
                        featuresByLayerId = {},
                        onCloseCB = angular.noop,
                        map = scope.map,
                        popup,
                        canceler,
                        vector,
                        vectorSource,
                        listenerKey,
                        parser = new ol.format.GeoJSON();

                    var is3dActive = function () {
                        return scope.ol3d && scope.ol3d.getEnabled();
                    };

                    // Destro popup and highlight
                    var initTooltip = function () {
                        // Cancel all pending requests
                        if (canceler) {
                            canceler.resolve();
                        }
                        // Create new cancel object
                        canceler = $q.defer();
                        // htmls = [] would break the reference in the popup
                        htmls.splice(0, htmls.length);
                        if (popup) {
                            popup.close();
                            $timeout(function () {
                                // We destroy the popup only if it's still closed
                                if (popup && popup.scope &&
                                    popup.scope.toggle === false) {
                                    popup.destroy();
                                    popup = undefined;
                                }
                            }, 0);
                        }

                        // Clear the preview features
                        gaPreviewFeatures.clear(map);

                        // Remove the remove layer listener if exist
                        if (listenerKey) {
                            ol.Observable.unByKey(listenerKey);
                        }
                    };
                    scope.$on('gaTopicChange', initTooltip);
                    scope.$on('gaTriggerTooltipInit', initTooltip);
                    scope.$on('gaTriggerTooltipRequest', function (event, data) {
                        if (!data.nohighlight) {
                            initTooltip();
                        }

                        // We use $timeout to execute the showFeature when the
                        // popup is correctly closed.
                        $timeout(function () {
                            showFeatures(null, data.features, undefined, data.nohighlight);
                            onCloseCB = data.onCloseCB;
                        }, 0);
                    });

                    scope.$on('gaTriggerTooltipInitOrUnreduce', function (event) {
                        if (popup && popup.scope.options.isReduced) {
                            popup.close();
                        } else {
                            initTooltip();
                        }
                    });

                    // Register the click on globe when ol3d is ready
                    scope.$watch('::ol3d', function (ol3d) {
                        if (ol3d) {
                            // Listen when the app switch between 2d/3d
                            scope.$watch(function () {
                                return scope.ol3d.getEnabled();
                            }, function (enabled) {
                                if (scope.isActive) {
                                    if (enabled) {
                                        deregMapEvents();
                                        registerGlobeEvents(scope, findFeatures);
                                    } else {
                                        deregGlobeEvents();
                                        registerMapEvents(scope, findFeatures);
                                    }
                                }
                            });
                        }
                    });

                    scope.$watch('isActive', function (active) {
                        if (active) {
                            if (is3dActive()) {
                                registerGlobeEvents(scope, findFeatures);
                            } else {
                                registerMapEvents(scope, findFeatures);
                            }
                        } else {
                            // Remove the highlighted feature when we deactivate the tooltip
                            initTooltip();
                            deregMapEvents();
                            deregGlobeEvents();
                        }
                    });


                    // Find features for all type of layers
                    var findFeatures = function (coordinate, position3d) {
                        initTooltip();
                        if (!coordinate || !ol.extent.containsCoordinate(gaMapUtils.defaultExtent,
                            coordinate)) {
                            return;
                        }
                        var size = map.getSize();
                        var mapExtent = map.getView().calculateExtent(size);
                        var identifyUrl = scope.options.identifyUrlTemplate
                                .replace('{Topic}', gaTopic.get().id),
                            layersToQuery = getLayersToQuery(map),
                            pixel = map.getPixelFromCoordinate(coordinate);

                        // When 3d is Active we use the cesium native function to get the
                        // first queryable feature.
                        if (is3dActive()) {
                            var pickedObjects = scope.ol3d.getCesiumScene().drillPick(position3d);
                            for (var i = 0, ii = pickedObjects.length; i < ii; i++) {
                                var prim = pickedObjects[i].primitive;
                                if (isFeatureQueryable(prim.olFeature)) {
                                    showVectorFeature(prim.olFeature, prim.olLayer);
                                    break;
                                }
                            }
                        }
                        for (var i = 0, ii = layersToQuery.length; i < ii; i++) {
                            var layerToQuery = layersToQuery[i];
                            if (!is3dActive() && isVectorLayer(layerToQuery)) {
                                var feature = findVectorFeature(map, pixel, layerToQuery);
                                if (feature) {
                                    showVectorFeature(feature, layerToQuery);
                                }
                            } else if (layerToQuery.bodId) { // queryable bod layers
                                // var tempLayer = gaLayers.getLayer(layerToQuery.bodId);
                                var coordinates = coordinate[0] + ',' + coordinate[1];
                                var pixels = geomCoord = pixel[0] + ',' + pixel[1];
                                var imgDisplay = size[0] + ',' + size[1] + ',96';

                                // TODO: check that Resolution get the size of 1 pixel in meters...
                                var coordsBuffer = scope.map.getView().getResolution() * scope.options.tolerance;

                                var params = {
                                    lang: $translate.use(),
                                    layer: 'all:' + layerToQuery.bodId,
                                    coordinates: coordinates,
                                    coordsBuffer: coordsBuffer,
                                    pixels: pixels,
                                    pixelsBuffer: scope.options.tolerance,
                                    mapExtent: mapExtent.join(','),
                                    imageDisplay: imgDisplay,
                                    geometryType: 'Point',
                                    geometryFormat: 'geojson'
                                };

                                //+++START+++
                                try {
                                    params.cqlFilter = layerToQuery.getSource().getParams().CQL_FILTER;
                                } catch (e) {
                                    //TODO Log the error
                                }
                                //+++END+++

                                // Only timeEnabled layers use the timeInstant parameter
                                if (layerToQuery.timeEnabled) {
                                    params.timeInstant = gaTime.get() ||
                                        yearFromString(layerToQuery.time);
                                }


                                var identifyClosure = function (layerSource, coords, parameters, url) {

                                    $http.get(url, {
                                        timeout: canceler.promise,
                                        params: parameters
                                    }).success(function (features) {
                                        showFeatures(layerSource, features.results, coords);
                                    });
                                };
                                identifyClosure(layerToQuery.wmsSource, coordinate, params, identifyUrl);
                            }
                        }
                    };

                    var distanceBetweenPoints = function (point1, point2) {
                        var c1 = ol.proj.transform(point1, 'EPSG:25832', 'EPSG:4326');
                        var c2 = ol.proj.transform(point2, 'EPSG:25832', 'EPSG:4326');
                        var length = map.wgs84Sphere.haversineDistance(c1, c2);
                        return length;
                    };

                    // Highlight the features found --> XXX FIXME XXX : PAY ATTENTION WHEN CALLING THIS METHOD, LAYERSOURCE IS OPTIONAL, IF UNKNOWN PUT "null".
                    var showFeatures = function (layerSource, foundFeatures, coordinate, nohighlight) {
                        if (foundFeatures && foundFeatures.length > 0) {
                            // Remove the tooltip, if a layer is removed, we don't care
                            // which layer. It worked like that in RE2.
                            listenerKey = map.getLayers().on('remove',
                                function (evt) {
                                    if (!evt.element.preview) {
                                        initTooltip();
                                    }
                                }
                            );
                            var size = map.getSize();
                            var mapExtent = map.getView().calculateExtent(size);
                            angular.forEach(foundFeatures, function (value) {
                                if (value instanceof ol.Feature) {
                                    var layerId = value.get('layerId');
                                    if (!featuresByLayerId[layerId]) {
                                        featuresByLayerId[layerId] = {};
                                    }
                                    var feature = new ol.Feature(value.getGeometry());
                                    feature.setId(value.getId());
                                    feature.set('layerId', layerId);
                                    gaPreviewFeatures.add(map, feature);

                                    showPopup(value.get('htmlpopup'));

                                    // Store the ol feature for highlighting
                                    featuresByLayerId[layerId][feature.getId()] = feature;
                                } else {
                                    if (!featuresByLayerId[value.layerBodId]) {
                                        featuresByLayerId[value.layerBodId] = {};
                                    }
                                    //draw feature, but only if it should be drawn
                                    if (!nohighlight && gaLayers.getLayer(value.layerBodId) && gaLayers.getLayerProperty(value.layerBodId, 'highlightable')) {
                                        var features = parser.readFeatures(value);
                                        for (var i = 0, ii = features.length; i < ii; ++i) {
                                            features[i].set('layerId', value.layerBodId);
                                            gaPreviewFeatures.add(map, features[i]);

                                            // Store the ol feature for highlighting
                                            featuresByLayerId[value.layerBodId][value.id] =
                                                features[i];
                                        }
                                    }

                                    //---START---
                                    /*
                                     var htmlUrl = scope.options.htmlUrlTemplate
                                     .replace('{Topic}', gaTopic.get().id)
                                     .replace('{Layer}', value.layerBodId)
                                     .replace('{Feature}', value.featureId);
                                     */
                                    //---END---
                                    var localSource = layerSource ? layerSource : gaLayers.getLayerProperty(value.layerBodId, 'wmsSource');
                                    if (localSource === null || localSource === undefined || localSource === 'internal') {

                                        //  if (layerSource === null || layerSource === undefined || layerSource === 'internal') {
                                        //If layer is 'internal' call htmlPopup
                                        //+++START+++
                                        var htmlUrl = gaUrlUtils.append(scope.options.htmlUrlTemplate, "layer=" + value.layerBodId);
                                        htmlUrl = gaUrlUtils.append(htmlUrl, "feature=" + value.id);
                                        //+++START+++
                                        $http.get(htmlUrl, {
                                            //---START---
                                            //timeout: canceler.promise,
                                            //---END---
                                            params: {
                                                lang: $translate.use(),
                                                mapExtent: mapExtent.join(','),
                                                coord: (coordinate) ? coordinate.join(',') : undefined,
                                                imageDisplay: size[0] + ',' + size[1] + ',96'
                                            },
                                            //+++START+++
                                            headers: {
                                                'Accept': 'text/html'
                                            }
                                            //+++END+++
                                        }).success(function (html) {
                                            /*
                                            var permalinkUrl = gaPermalink.getHref();
                                            var permalinkUrlArray = permalinkUrl.split('&');
                                            var permalinkUrlArrayFiltered = permalinkUrlArray.filter( function (el){
                                              return el.indexOf('layer=') ==-1 && el.indexOf('feature=') ==-1
                                          });
                                            var permalinkUrlFiltered = permalinkUrlArrayFiltered.join('&');
                                          */
                                            gaPermalink.deleteParam('layer');
                                            gaPermalink.deleteParam('feature');
                                            gaPermalink.deleteParam('showTooltip');

                                            var linkToFeature = [
                                                '<tr>',
                                                '<td>Condividi</td>',
                                                '<td>',
                                                '<a target="_blank" href="' + gaPermalink.getHref() + '&showTooltip=true' + '&layer=' + value.layerBodId + '&feature=' + value.properties.classid + '">Link all\'oggetto</a>',
                                                '</td>',
                                                '</tr>',
                                                '</table>'
                                            ].join('');
                                            var htmlArray = html.split("</table>");
                                            var enrichedPopup = htmlArray[0] + linkToFeature + htmlArray[1];
                                            showPopup(enrichedPopup);
                                        });
                                    } else {
                                        //else (build up html using the "features" and javascript
                                        var htmlpopup =
                                            '<div id="{{id}}" class="htmlpopup-container">' +
                                            '<div class="htmlpopup-header">' +
                                            '{{name}}' +
                                            '</div>' +
                                            '<div class="htmlpopup-content">' +
                                            '{{properties}}' +
                                            '</div>' +
                                            '</div><br/>';
                                        var name = value.layerName; // else must get feature id and take the part of string 0...(firstIndexOf(.))
                                        var featureId = value.id;
                                        var layerId = value.layerId || value.bodId || value.layerBodId;
                                        var id = layerId + '#' + featureId;

                                        var properties = '';
                                        if (value.properties !== undefined && Object.keys(value.properties).length > 0) {
                                            properties += '<table>';
                                            angular.forEach(value.properties, function (singleProperty, key) {
                                                properties += '<tr><td>' + key + '</td><td>' + singleProperty + '</td></tr>';
                                            });
                                            properties += '</table>';
                                        }

                                        htmlpopup = htmlpopup.replace('{{id}}', id).replace('{{properties}}', properties || '').replace('{{name}}', (name) ? '(' + name + ')' : '');
                                        value.htmlpopup = htmlpopup;
                                        value.layerId = layerId;
                                        showPopup(htmlpopup);

                                    }
                                }
                            });
                        }
                    };

                    // Create the html popup for a feature then display it.
                    var showVectorFeature = function (feature, layer) {
                        var htmlpopup =
                            '<div id="{{id}}" class="htmlpopup-container">' +
                            '<div class="htmlpopup-header">' +
                            '<span>' + layer.label + ' &nbsp;</span>' +
                            '{{name}}' +
                            '</div>' +
                            '<div class="htmlpopup-content">' +
                            '{{descr}}' +
                            '</div>' +
                            '</div>';
                        var name = feature.get('name');
                        var featureId = feature.getId();
                        var layerId = feature.get('layerId') || layer.get('bodId');
                        var id = layerId + '#' + featureId;
                        htmlpopup = htmlpopup.replace('{{id}}', id).replace('{{descr}}', feature.get('description') || '').replace('{{name}}', (name) ? '(' + name + ')' : '');
                        feature.set('htmlpopup', htmlpopup);
                        feature.set('layerId', layerId);
                        showFeatures(null, [feature]);
                        // Iframe communication from inside out
                        if (top != window) {
                            if (featureId && layerId) {
                                window.parent.postMessage(id, '*');
                            }
                        }
                    };

                    // Show the popup with all features informations
                    var showPopup = function (html) {
                        // Show popup on first result
                        if (htmls.length === 0) {
                            if (!popup) {
                                popup = gaPopup.create({
                                    className: 'ga-tooltip',
                                    openImmaginiPopup: function (layer, feature, lang) {
                                        getCarousel(layer, feature, lang);
                                    },
                                    onCloseCallback: function () {
                                        if (onCloseCB) {
                                            onCloseCB();
                                        }
                                        onCloseCB = angular.noop;
                                        gaPreviewFeatures.clear(map);
                                    },
                                    onMouseEnter: function (evt, nbTooltips) {
                                        if (nbTooltips == 1) return;
                                        var target = $(evt.currentTarget).addClass('ga-active');
                                        var containerId = target.find('.htmlpopup-container').attr('id');
                                        if (/#/.test(containerId)) {
                                            var split = containerId.split('#');
                                            gaPreviewFeatures.highlight(map,
                                                featuresByLayerId[split[0]][split[1]]);
                                        }
                                    },
                                    onMouseLeave: function (evt) {
                                        $(evt.currentTarget).removeClass('ga-active');
                                        gaPreviewFeatures.clearHighlight();
                                    },
                                    title: 'object_information',
                                    content: popupContent,
                                    htmls: htmls,
                                    showPrint: true
                                });
                            }
                            popup.open();
                            //always reposition element when newly opened
                            if (!gaBrowserSniffer.mobile) {
                                popup.element.css({
                                    left: ((map.getSize()[0] / 2) -
                                        (parseFloat(popup.element.css('max-width')) / 2))
                                });
                            }
                        }
                        // Add result to array. ng-repeat will take
                        // care of the rest
                        htmls.push($sce.trustAsHtml(html));
                    };

                    var getCarousel = function (layer, feature, lang) {
                        var urlReq = scope.options.carouselUrlTemplate;
                        $http.get(urlReq, {
                            params: {
                                layer: layer,
                                feature: feature,
                                lang: lang
                            },
                            headers: {
                                'Accept': 'text/html'
                            }
                        }).success(function (html) {
                            showCarousel($sce.trustAsHtml(html));
                        });
                    };

                    var showCarousel = function (html) {
                        var carouselPopup = gaPopup.create({
                            className: 'ga-tooltip',
                            title: 'object_images',
                            content: html
                        });
                        carouselPopup.open();
                        //always reposition element when newly opened
                        if (!gaBrowserSniffer.mobile) {
                            carouselPopup.element.css({
                                left: ((map.getSize()[0] / 2) -
                                    (parseFloat(popup.element.css('max-width')) / 2))
                            });
                        }
                    };

                    // end link param
                }

            };
        });
})();
