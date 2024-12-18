// SystemConfig.js - No usar import/export aquí
window.SystemConfigDialog = () => {
  const [isVisible, setIsVisible] = React.useState(false);
  const [systemDirectives, setSystemDirectives] = React.useState('');
  const [cacheContext, setCacheContext] = React.useState('');

  React.useEffect(() => {
      const loadConfigs = async () => {
          if (isVisible) {
              try {
                  const response = await fetch('/api/system-config');
                  if (response.ok) {
                      const data = await response.json();
                      setSystemDirectives(data.systemDirectives || '');
                      setCacheContext(data.cacheContext || '');
                  }
              } catch (error) {
                  console.error('Error loading configurations:', error);
              }
          }
      };

      loadConfigs();
  }, [isVisible]);

  const handleSave = async () => {
      try {
          const response = await fetch('/api/system-config', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                  systemDirectives,
                  cacheContext
              })
          });

          if (response.ok) {
              setIsVisible(false);
          } else {
              console.error('Error saving configuration');
          }
      } catch (error) {
          console.error('Error saving configurations:', error);
      }
  };

  if (!isVisible) {
      return React.createElement('button', {
          onClick: () => setIsVisible(true),
          className: 'btn btn-secondary w-full'
      }, 'System Directives & Cache');
  }

  return React.createElement('div', {
      className: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50'
  }, 
      React.createElement('div', {
          className: 'w-full max-w-2xl bg-gray-800 rounded-lg shadow-xl p-6'
      }, [
          React.createElement('h2', {
              className: 'text-xl font-bold mb-4 text-white',
              key: 'title'
          }, 'System Configuration'),
          
          React.createElement('div', {
              className: 'space-y-4',
              key: 'form'
          }, [
              React.createElement('div', { key: 'directives-container' }, [
                  React.createElement('label', {
                      className: 'block text-sm font-medium text-gray-200 mb-2',
                      key: 'directives-label'
                  }, 'System Directives'),
                  React.createElement('textarea', {
                      className: 'w-full h-40 px-3 py-2 text-white bg-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500',
                      value: systemDirectives,
                      onChange: (e) => setSystemDirectives(e.target.value),
                      placeholder: 'Enter system directives here...',
                      key: 'directives-input'
                  })
              ]),
              
              React.createElement('div', { key: 'cache-container' }, [
                  React.createElement('label', {
                      className: 'block text-sm font-medium text-gray-200 mb-2',
                      key: 'cache-label'
                  }, 'Context for Cache'),
                  React.createElement('textarea', {
                      className: 'w-full h-40 px-3 py-2 text-white bg-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500',
                      value: cacheContext,
                      onChange: (e) => setCacheContext(e.target.value),
                      placeholder: 'Enter additional context for cache...',
                      key: 'cache-input'
                  })
              ])
          ]),
          
          React.createElement('div', {
              className: 'flex justify-end space-x-4 mt-6',
              key: 'buttons'
          }, [
              React.createElement('button', {
                  onClick: () => setIsVisible(false),
                  className: 'btn btn-secondary',
                  key: 'cancel'
              }, 'Cancel'),
              React.createElement('button', {
                  onClick: handleSave,
                  className: 'btn btn-primary',
                  key: 'save'
              }, 'Save Configuration')
          ])
      ])
  );
};