# Value factories for the instance a method is called on

A class keeps the platform it was built for, and its method branches on it. Faultline calls a method on an instance built with each constructor parameter's first value, which reaches one platform. The sim file beside the source has value factories returning the class, one per platform, so Faultline calls the method on each instance they give.
