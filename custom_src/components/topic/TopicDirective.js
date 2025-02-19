goog.provide('ga_topic_directive');

goog.require('ga_topic_service');
(function() {

  var module = angular.module('ga_topic_directive', [
    'ga_topic_service'
  ]);

  module.directive('gaTopic',
      function($rootScope, gaTopic) {
        return {
          restrict: 'A',
          templateUrl: function(element, attrs) {
            return 'components/topic/partials/topic.' +
              ((attrs.gaTopicUi == 'select') ? 'select.html' : 'html');
          },
          scope: {},
          link: function(scope, element, attrs) {

            // Because ng-repeat creates a new scope for each item in the
            // collection we can't use ng-click="activeTopic = topic" in
            // the template. Hence this intermediate function.
            // see: https://groups.google.com/forum/#!topic/angular/nS80gSdZBsE
            scope.setActiveTopic = function(newTopic) {
              scope.activeTopic = newTopic;
            };

            scope.$watch('activeTopic', function(newTopic) {
              if (newTopic && scope.topics) {
                gaTopic.set(newTopic);
              }
            });

            //---START---
            /*gaTopic.loadConfig().then(function() {
              scope.topics = gaTopic.getTopics();
              scope.activeTopic = gaTopic.get();
              scope.$applyAsync(function() {
                element.find('.ga-topic-item').tooltip({
                  placement: 'bottom'
                });
              });
              scope.$on('gaTopicChange', function(evt, newTopic) {
                if (scope.activeTopic != newTopic) {
                  scope.activeTopic = newTopic;
                }
              });
            });*/
            //---END---

            //+++START+++
            var update = function() {
              scope.topics = gaTopic.getTopics();
              scope.activeTopic = gaTopic.get();
              scope.$applyAsync(function() {
                element.find('.ga-topic-item').tooltip({
                  placement: 'bottom'
                });
              });
              scope.$on('gaTopicChange', function(evt, newTopic) {
                if (scope.activeTopic != newTopic) {
                  scope.activeTopic = newTopic;
                }
              });
            };

            gaTopic.loadConfig().then(update)

            $rootScope.$on('$translateChangeEnd', function(evt, newLang) {
              gaTopic.reload().then(update)
            });
            //+++END+++
          }
        };
      });
})();
